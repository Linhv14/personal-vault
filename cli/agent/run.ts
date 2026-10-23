import { spawn } from "node:child_process";
import { describe, plan } from "./plan.js";
import { openSandbox, type Sandbox } from "./sandbox.js";
import {
  AgentError,
  noteAccess,
  selectEnvironment,
  signIn,
  signOut,
  type Selected,
  type Session,
} from "./session.js";

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

export async function runAgent(options: AgentOptions): Promise<number> {
  const [program, ...args] = options.command;
  if (!program) {
    throw new AgentError("Nothing to run: add -- <command>");
  }
  const session: Session =
    options.session ??
    (await signIn(
      options.server,
      options.email,
      await options.askPassword(`Master password for ${options.email}: `),
      options.request,
      options.askCode,
    ));
  let sandbox: Sandbox | undefined;
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
    for (const line of describe(prepared)) {
      options.log(line);
    }
    if (prepared.injectables.length === 0) {
      options.log(
        "7key: no secret has allowed hosts yet. In the console, open the project and press Apply suggested hosts, or Agent hosts under a secret's name.",
      );
    }
    if (!options.yes && !(await options.confirm("Allow? [y/N] "))) {
      return 1;
    }

    const reported = new Set<string>();
    sandbox = await openSandbox(prepared, {
      upstreamCa: options.upstreamCa,
      resolve: options.resolve,
      onUse: (entry, host) => {
        const key = `${entry.name}@${host}`;
        if (reported.has(key)) {
          return;
        }
        reported.add(key);
        options.log(`7key: used ${entry.name} for ${host}`);
        if (reported.size === 1) {
          void noteAccess(session, selected, "injected");
        }
      },
    });
    const env = sandbox.env(options.env);
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
      for (const [signal, handler] of handlers) {
        process.on(signal, handler);
      }
      const done = (result: number) => {
        for (const [signal, handler] of handlers) {
          process.off(signal, handler);
        }
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
    await sandbox?.close();
    if (!options.session) {
      await signOut(session);
    }
  }
}
