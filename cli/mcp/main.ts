import { DEFAULT_SERVER } from "#core/brand.js";
import { currentSession, defaultContext, resolveSelection } from "../account/commands.js";
import { loadLogin } from "../account/credentials.js";
import { heldLoginMessage, holdLogin, loginHold } from "../account/login-hold.js";
import { CLI_VERSION } from "../version.js";
import { MCP_USAGE, parseMcpArgs } from "./args.js";
import { unavailable, vaultBackend } from "./backend.js";
import { serveMcp } from "./server.js";

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
    const hold = loginHold(env);
    const reason = hold
      ? `${heldLoginMessage(hold)} Ask the user to stop it, or run 7key login if it is gone, then restart the 7key MCP server.`
      : `Not logged in to 7key (${env.SEVENKEY_SERVER ?? DEFAULT_SERVER}). Ask the user to run 7key login in a terminal and restart the 7key MCP server.`;
    log(`7key mcp: ${reason}`);
    await serveMcp({
      input: process.stdin,
      output: process.stdout,
      backend: unavailable(reason),
      version: CLI_VERSION,
      allowWithoutAsking: false,
      log,
    });
    return 0;
  }
  const restore = holdLogin(env, context.keyring, "7key mcp");
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
