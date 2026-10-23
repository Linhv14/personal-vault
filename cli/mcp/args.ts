import type { Flags } from "../account/commands.js";
import { AgentError } from "../agent/session.js";

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

export interface McpArgs {
  flags: Flags;
  yes: boolean;
  help: boolean;
}

export function parseMcpArgs(argv: string[]): McpArgs {
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
