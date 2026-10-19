import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_SERVER } from "../../src/core/brand.js";
import { runAgent } from "./run.js";
import { AgentError } from "./session.js";
import { askHidden, confirm } from "./terminal.js";

export const AGENT_USAGE = `Usage: 7key agent --project <name> --env <name> [options] -- <command…>

Runs a command, such as an AI coding agent, that can call APIs with a project's
secrets without ever seeing them. The command gets a placeholder in place of
each secret; a local proxy swaps in the real value only on requests to the
hosts allowed for that secret in the 7key console.

Options
  --project <name>    Project, as named in the console
  --org <name>        Organization, when several have a project of that name
  --env <name>        Environment, such as Development
  --email <address>   Your 7key account (or SEVENKEY_EMAIL; remembered)
  --server <url>      7key server (or SEVENKEY_SERVER, default ${DEFAULT_SERVER})
  --yes               Skip the confirmation
`;

export interface AgentArgs {
  org?: string;
  project?: string;
  environment?: string;
  email?: string;
  server?: string;
  yes: boolean;
  help: boolean;
  command: string[];
}

export function parseAgentArgs(argv: string[]): AgentArgs {
  const parsed: AgentArgs = { yes: false, help: false, command: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new AgentError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--") {
      parsed.command = argv.slice(index + 1);
      break;
    }
    if (arg === "--project") parsed.project = value();
    else if (arg === "--org") parsed.org = value();
    else if (arg === "--env") parsed.environment = value();
    else if (arg === "--email") parsed.email = value();
    else if (arg === "--server") parsed.server = value();
    else if (arg === "--yes" || arg === "-y") parsed.yes = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new AgentError(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

interface Remembered {
  email?: string;
  server?: string;
}

function configFile(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
  return path.join(base, "7key", "config.json");
}

function remembered(env: NodeJS.ProcessEnv): Remembered {
  const file = configFile(env);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Remembered;
  } catch {
    return {};
  }
}

function remember(env: NodeJS.ProcessEnv, value: Remembered): void {
  const file = configFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function agentMain(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseAgentArgs(argv);
  if (args.help) {
    console.log(AGENT_USAGE);
    return 0;
  }
  const saved = remembered(env);
  const email = args.email ?? env.SEVENKEY_EMAIL ?? saved.email;
  const server = args.server ?? env.SEVENKEY_SERVER ?? saved.server ?? DEFAULT_SERVER;
  if (!args.project || !args.environment || args.command.length === 0) {
    throw new AgentError(`Missing --project, --env or the command\n\n${AGENT_USAGE}`);
  }
  if (!email) throw new AgentError("Pass --email the first time");
  remember(env, { email, server });
  return runAgent({
    server,
    email,
    org: args.org,
    project: args.project,
    environment: args.environment,
    yes: args.yes,
    command: args.command,
    env,
    askPassword: askHidden,
    confirm,
    log: (line) => console.error(line),
  });
}
