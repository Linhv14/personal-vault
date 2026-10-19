import { DEFAULT_SERVER } from "../../src/core/brand.js";
import {
  currentSession,
  defaultContext,
  resolveSelection,
  type Flags,
} from "../account/commands.js";
import { pauseLogin } from "../account/credentials.js";
import { remember, remembered } from "./config.js";
import { runAgent } from "./run.js";
import { AgentError } from "./session.js";
import { askHidden, confirm } from "./terminal.js";

export const AGENT_USAGE = `Usage: 7key agent [options] -- <command…>

Runs a command, such as an AI coding agent, that can call APIs with a project's
secrets without ever seeing them. The command gets a placeholder in place of
each secret; a local proxy swaps in the real value only on requests to the
hosts allowed for that secret in the 7key console.

In a folder linked with \`7key link\`, and after \`7key login\`, no option is
needed. Otherwise pass --project and --env, and type your master password.

Options
  --project <ref>     Project id, handle (trust1-portal) or name
  --org <ref>         Organization, when several have a project of that name
  --env <ref>         Environment, such as development (overrides the link)
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

export async function agentMain(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseAgentArgs(argv);
  if (args.help) {
    console.log(AGENT_USAGE);
    return 0;
  }
  if (args.command.length === 0) {
    throw new AgentError(`Missing the command\n\n${AGENT_USAGE}`);
  }
  const context = defaultContext(env);
  const session = currentSession(context);
  const flags: Flags = {
    org: args.org,
    project: args.project,
    environment: args.environment,
    command: args.command,
  };
  if (session) {
    const restore = pauseLogin(env, context.keyring);
    const restoreOnExit = () => restore();
    process.once("exit", restoreOnExit);
    try {
      return await runAgent({
        server: session.server,
        email: "",
        session,
        select: (current) => resolveSelection(flags, context, current),
        yes: args.yes,
        command: args.command,
        env,
        askPassword: askHidden,
        confirm,
        log: (line) => console.error(line),
      });
    } finally {
      process.off("exit", restoreOnExit);
      restore();
    }
  }
  const saved = remembered(env);
  const email = args.email ?? env.SEVENKEY_EMAIL ?? saved.email;
  const server = args.server ?? env.SEVENKEY_SERVER ?? saved.server ?? DEFAULT_SERVER;
  if (!args.project || !args.environment) {
    throw new AgentError("Run 7key login and 7key link first, or pass --project and --env");
  }
  if (!email) throw new AgentError("Pass --email the first time, or run 7key login");
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
