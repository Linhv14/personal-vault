import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { isVariable, type SecretContent } from "../../src/core/projects.js";
import { createAuthority } from "./certs.js";
import { startProxy } from "./proxy.js";
import {
  AgentError,
  noteAccess,
  selectEnvironment,
  signIn,
  signOut,
  type Selected,
  type Session,
} from "./session.js";
import { MIN_SECRET_LENGTH, newPlaceholder, type Injectable } from "./substitute.js";

export interface AgentOptions {
  server: string;
  email: string;
  session?: Session;
  select?: (session: Session) => Promise<Selected>;
  org?: string;
  project?: string;
  environment?: string;
  yes: boolean;
  command: string[];
  env: NodeJS.ProcessEnv;
  askPassword: (question: string) => Promise<string>;
  askCode?: (question: string) => Promise<string>;
  confirm: (question: string) => Promise<boolean>;
  log: (line: string) => void;
  request?: typeof fetch;
  upstreamCa?: string;
  resolve?: (host: string) => string;
}

export interface Plan {
  injectables: Injectable[];
  variables: SecretContent[];
  skipped: string[];
  tooShort: string[];
}

export function plan(secrets: readonly SecretContent[]): Plan {
  const injectables: Injectable[] = [];
  const variables: SecretContent[] = [];
  const skipped: string[] = [];
  const tooShort: string[] = [];
  for (const secret of secrets) {
    if (isVariable(secret)) variables.push(secret);
    else if (!secret.hosts || secret.hosts.length === 0) skipped.push(secret.name);
    else if (secret.value.length < MIN_SECRET_LENGTH) tooShort.push(secret.name);
    else {
      injectables.push({
        name: secret.name,
        value: secret.value,
        hosts: secret.hosts,
        placeholder: newPlaceholder(),
      });
    }
  }
  return { injectables, variables, skipped, tooShort };
}

const CA_VARIABLES = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
];

export function childEnvironment(
  base: NodeJS.ProcessEnv,
  selected: Plan,
  proxyUrl: string,
  files: { authority: string; bundle: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of Object.keys(env)) {
    if (name.startsWith("SEVENKEY_")) delete env[name];
  }
  for (const { name, value } of selected.variables) env[name] = value;
  for (const { name, placeholder } of selected.injectables) env[name] = placeholder;
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
    env[name] = proxyUrl;
  }
  const noProxy = ["localhost", "127.0.0.1", "::1"];
  env.NO_PROXY = env.no_proxy = noProxy.join(",");
  env.NODE_USE_ENV_PROXY = "1";
  env.NODE_EXTRA_CA_CERTS = files.authority;
  for (const name of CA_VARIABLES) env[name] = files.bundle;
  env.SEVENKEY_AGENT = "1";
  return env;
}

function describe(selected: Plan): string[] {
  const width = Math.max(4, ...selected.injectables.map((entry) => entry.name.length));
  const lines = selected.injectables.map(
    (entry) => `  ${entry.name.padEnd(width)}  → ${entry.hosts.join(", ")}`,
  );
  if (selected.variables.length > 0) {
    lines.push(`  variables: ${selected.variables.map((entry) => entry.name).join(", ")}`);
  }
  if (selected.skipped.length > 0) {
    lines.push(
      `  not available (no allowed hosts, set them in the console): ${selected.skipped.join(", ")}`,
    );
  }
  if (selected.tooShort.length > 0) {
    lines.push(
      `  not available (shorter than ${MIN_SECRET_LENGTH} characters): ${selected.tooShort.join(", ")}`,
    );
  }
  return lines;
}

export async function runAgent(options: AgentOptions): Promise<number> {
  const [program, ...args] = options.command;
  if (!program) throw new AgentError("Nothing to run: add -- <command>");
  const session: Session =
    options.session ??
    (await signIn(
      options.server,
      options.email,
      await options.askPassword(`Master password for ${options.email}: `),
      options.request,
      options.askCode,
    ));
  let directory: string | undefined;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  try {
    const selected = options.select
      ? await options.select(session)
      : await selectEnvironment(
          session,
          options.project ?? "",
          options.environment ?? "",
          options.org,
        );
    const prepared = plan(selected.secrets);
    options.log(
      `7key: ${selected.projectName} / ${selected.environment.name} for ${[program, ...args].join(" ")}`,
    );
    for (const line of describe(prepared)) options.log(line);
    if (prepared.injectables.length === 0) {
      options.log(
        "7key: no secret has allowed hosts yet. In the console, open the project and press Apply suggested hosts, or Agent hosts under a secret's name.",
      );
    }
    if (!options.yes && !(await options.confirm("Allow? [y/N] "))) return 1;

    const authority = createAuthority();
    directory = mkdtempSync(path.join(tmpdir(), "7key-agent-"));
    const files = {
      authority: path.join(directory, "ca.pem"),
      bundle: path.join(directory, "bundle.pem"),
    };
    writeFileSync(files.authority, authority.cert, { mode: 0o600 });
    writeFileSync(files.bundle, [...tls.rootCertificates, authority.cert].join("\n"), {
      mode: 0o600,
    });

    const reported = new Set<string>();
    proxy = await startProxy({
      injectables: prepared.injectables,
      authority,
      upstreamCa: options.upstreamCa,
      resolve: options.resolve,
      onUse: (entry, host) => {
        const key = `${entry.name}@${host}`;
        if (reported.has(key)) return;
        reported.add(key);
        options.log(`7key: used ${entry.name} for ${host}`);
        if (reported.size === 1) void noteAccess(session, selected, "injected");
      },
    });
    const env = childEnvironment(options.env, prepared, proxy.url, files);
    options.log(
      options.session
        ? "7key: starting. 7key never asks for your password while this command runs."
        : "7key: starting. 7key will not ask for your password again until this command exits.",
    );
    const code = await new Promise<number>((resolve) => {
      const child = spawn(program, args, { stdio: "inherit", env });
      const ignore = () => {};
      const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
      const handlers: [NodeJS.Signals, () => void][] = [
        ["SIGINT", ignore],
        ["SIGQUIT", ignore],
        ["SIGTERM", forward("SIGTERM")],
        ["SIGHUP", forward("SIGHUP")],
      ];
      for (const [signal, handler] of handlers) process.on(signal, handler);
      const done = (result: number) => {
        for (const [signal, handler] of handlers) process.off(signal, handler);
        resolve(result);
      };
      child.on("close", (exit, signal) => done(exit ?? (signal ? 128 : 1)));
      child.on("error", (error) => {
        options.log(`7key: ${error.message}`);
        done(127);
      });
    });
    options.log("7key: session ended; the secrets are no longer reachable.");
    return code;
  } finally {
    await proxy?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (!options.session) await signOut(session);
  }
}
