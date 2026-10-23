import { spawn } from "node:child_process";
import { DEFAULT_SERVER } from "#core/brand.js";
import { isVariable } from "#core/projects.js";
import {
  currentSession,
  defaultContext,
  resolveSelection,
  type Flags,
} from "../account/commands.js";
import { loadLogin, pauseLogin } from "../account/credentials.js";
import { describe, openSandbox, plan, type Plan, type Sandbox } from "../agent/run.js";
import { AgentError, noteAccess, type Selected, type Session } from "../agent/session.js";
import { MIN_SECRET_LENGTH, scrub } from "../agent/substitute.js";
import { CLI_VERSION } from "../version.js";
import { serveMcp, type McpBackend, type RunResult } from "./server.js";

export const MCP_USAGE = `Usage: 7key mcp [options]

Serves 7key to an AI agent over the Model Context Protocol (stdio). The agent can
list the names of a project's secrets and run commands with them, but only ever
sees placeholders: a local proxy puts the real value into requests to the hosts
allowed for each secret. While the server runs, your login is set aside so the
agent cannot use 7key run or 7key read.

Sign in first with 7key login, then add it to your agent, for example:
  claude mcp add 7key -- 7key mcp
  claude mcp add 7key -- 7key mcp --project payments-api --env development

Options
  --project <ref>     Project id, handle or name (default: the folder's link)
  --env <ref>         Environment, such as development
  --org <ref>         Organization, when several have a project of that name
  --yes               Allow commands with secrets without asking, for clients
                      that cannot show a permission prompt
`;

const OUTPUT_LIMIT = 64 * 1024;

interface McpArgs {
  flags: Flags;
  yes: boolean;
  help: boolean;
}

function parseMcpArgs(argv: string[]): McpArgs {
  const parsed: McpArgs = { flags: { command: [] }, yes: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) {
        throw new AgentError(`${arg} needs a value`);
      }
      return next;
    };
    if (arg === "--project") {
      parsed.flags.project = value();
    } else if (arg === "--env") {
      parsed.flags.environment = value();
    } else if (arg === "--org") {
      parsed.flags.org = value();
    } else if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new AgentError(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

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

function unavailable(reason: string): McpBackend {
  const fail = () => Promise.reject(new AgentError(reason));
  return { setup: fail, secrets: fail, run: fail, permission: fail };
}

export async function mcpMain(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseMcpArgs(argv);
  if (args.help) {
    console.log(MCP_USAGE);
    return 0;
  }
  const log = (line: string) => console.error(line);
  const context = defaultContext(env);
  const stored = loadLogin(context.keyring);
  const session = currentSession(context);
  if (!session || !stored) {
    log("7key mcp: not logged in. Run 7key login in a terminal, then restart this server.");
    await serveMcp({
      input: process.stdin,
      output: process.stdout,
      backend: unavailable(
        `Not logged in to 7key (${env.SEVENKEY_SERVER ?? DEFAULT_SERVER}). Ask the user to run 7key login in a terminal and restart the 7key MCP server.`,
      ),
      version: CLI_VERSION,
      allowWithoutAsking: false,
      log,
    });
    return 0;
  }
  const restore = pauseLogin(env, context.keyring);
  const backend = vaultBackend(
    session,
    stored.email,
    () => resolveSelection(args.flags, context, session),
    log,
  );
  const stop = () => {
    restore();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  process.once("exit", restore);
  log(
    `7key mcp: serving ${stored.email} on ${session.server}; your login is set aside until it stops.`,
  );
  try {
    await serveMcp({
      input: process.stdin,
      output: process.stdout,
      backend,
      version: CLI_VERSION,
      allowWithoutAsking: args.yes,
      log,
    });
  } finally {
    await backend.close();
    restore();
  }
  return 0;
}
