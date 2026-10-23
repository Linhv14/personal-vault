import { spawn } from "node:child_process";
import { isVariable } from "#core/projects.js";
import { describe, plan, type Plan } from "../agent/plan.js";
import { openSandbox, type Sandbox } from "../agent/sandbox.js";
import { AgentError, noteAccess, type Selected, type Session } from "../agent/session.js";
import { MIN_SECRET_LENGTH, scrub } from "../agent/substitute.js";

export interface SetupInfo {
  account: string;
  server: string;
  project: string;
  environment: string;
  scope: string;
}

export interface SecretListing {
  name: string;
  kind: "secret" | "variable";
  hosts: string[];
  usable: boolean;
  reason?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface McpBackend {
  setup(): Promise<SetupInfo>;
  secrets(): Promise<SecretListing[]>;
  run(request: {
    command: string;
    args: string[];
    cwd?: string;
    timeoutMs: number;
  }): Promise<RunResult>;
  permission(): Promise<string[]>;
}

const OUTPUT_LIMIT = 64 * 1024;

function capped(text: string): string {
  return text.length > OUTPUT_LIMIT
    ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more characters cut`
    : text;
}

export function vaultBackend(
  session: Session,
  account: string,
  select: () => Promise<Selected>,
  log: (line: string) => void,
  network: { upstreamCa?: string; resolve?: (host: string) => string } = {},
): McpBackend & { close(): Promise<void> } {
  let chosen: Promise<{ selected: Selected; prepared: Plan }> | null = null;
  let sandbox: Promise<Sandbox> | null = null;
  const reported = new Set<string>();
  const load = () =>
    (chosen ??= select().then((selected) => ({ selected, prepared: plan(selected.secrets) })));
  return {
    async setup() {
      const { selected } = await load();
      return {
        account,
        server: session.server,
        project: selected.projectName,
        environment: selected.environment.name,
        scope: "names and placeholders only; values go only to each secret's allowed hosts",
      };
    },
    async secrets() {
      const { selected, prepared } = await load();
      const usable = new Set(prepared.injectables.map((entry) => entry.name));
      return selected.secrets.map((secret) => {
        if (isVariable(secret)) {
          return { name: secret.name, kind: "variable" as const, hosts: [], usable: true };
        }
        const hosts = secret.hosts ?? [];
        return {
          name: secret.name,
          kind: "secret" as const,
          hosts,
          usable: usable.has(secret.name),
          ...(usable.has(secret.name)
            ? {}
            : {
                reason:
                  hosts.length === 0
                    ? "no allowed hosts; set them in the 7key console"
                    : `shorter than ${MIN_SECRET_LENGTH} characters`,
              }),
        };
      });
    },
    async permission() {
      return describe((await load()).prepared);
    },
    async run(request) {
      const { selected, prepared } = await load();
      sandbox ??= openSandbox(prepared, {
        ...network,
        onUse: (entry, host) => {
          const key = `${entry.name}@${host}`;
          if (reported.has(key)) {
            return;
          }
          reported.add(key);
          log(`7key mcp: used ${entry.name} for ${host}`);
          if (reported.size === 1) {
            void noteAccess(session, selected, "injected");
          }
        },
      });
      const env = (await sandbox).env(process.env);
      return new Promise<RunResult>((resolve) => {
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let timedOut = false;
        const child = spawn(request.command, request.args, {
          cwd: request.cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2000).unref();
        }, request.timeoutMs);
        child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
        const finish = (exitCode: number, extra = "") => {
          clearTimeout(timer);
          const clean = (chunks: Buffer[]) =>
            capped(scrub(Buffer.concat(chunks).toString("utf8"), prepared.injectables));
          resolve({ exitCode, stdout: clean(out), stderr: clean(err) + extra, timedOut });
        };
        child.on("error", (error) => finish(127, error.message));
        child.on("close", (code, signal) => finish(code ?? (signal ? 128 : 1)));
      });
    },
    async close() {
      if (sandbox) {
        await (await sandbox).close();
      }
    },
  };
}

export function unavailable(reason: string): McpBackend {
  const fail = () => Promise.reject(new AgentError(reason));
  return { setup: fail, secrets: fail, run: fail, permission: fail };
}
