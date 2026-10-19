import { spawn } from "node:child_process";
import { formatDotenv } from "../src/core/projects.js";
import { agentMain } from "./agent/main.js";
import { CiError, DEFAULT_SERVER, exportToGithubEnv, fetchSecrets } from "./ci-client.js";

const USAGE = `Usage: 7key <command> [options]

  run -- <command…>   Run a command with the linked secrets in its environment
  env                 Export the linked secrets to later GitHub Actions steps
  dotenv              Print the linked secrets as a .env file
  agent               Let a command, such as an AI agent, use secrets it cannot see
                      (7key agent --help)

Options
  --link <ref>        Repository link, as shown in the 7key console (or SEVENKEY_LINK)
  --server <url>      7key server (or SEVENKEY_SERVER, default ${DEFAULT_SERVER})

The repository key is read from SEVENKEY_KEY, which should be a GitHub secret.
`;

interface Parsed {
  command: string | undefined;
  link: string | undefined;
  server: string;
  rest: string[];
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Parsed {
  const parsed: Parsed = {
    command: undefined,
    link: env.SEVENKEY_LINK,
    server: env.SEVENKEY_SERVER ?? DEFAULT_SERVER,
    rest: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") {
      parsed.rest = argv.slice(index + 1);
      break;
    }
    if (arg === "--link") parsed.link = argv[++index];
    else if (arg === "--server") parsed.server = argv[++index] ?? parsed.server;
    else if (!parsed.command) parsed.command = arg;
    else throw new CiError(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  if (argv[0] === "agent") return agentMain(argv.slice(1), env);
  const { command, link, server, rest } = parseArgs(argv, env);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (!link) throw new CiError("Pass --link or set SEVENKEY_LINK");
  const repoKey = env.SEVENKEY_KEY;
  if (!repoKey) throw new CiError("Set SEVENKEY_KEY to the repository key from the 7key console");
  const secrets = await fetchSecrets({ server, link, repoKey, env });

  switch (command) {
    case "dotenv":
      process.stdout.write(formatDotenv(secrets));
      return 0;
    case "env":
      await exportToGithubEnv(secrets, env);
      console.log(`7key: exported ${secrets.length} values`);
      return 0;
    case "run": {
      const [program, ...args] = rest;
      if (!program) throw new CiError("Nothing to run: add -- <command>");
      const childEnv = { ...env };
      delete childEnv.SEVENKEY_KEY;
      for (const { name, value } of secrets) childEnv[name] = value;
      return new Promise((resolve) => {
        const child = spawn(program, args, { stdio: "inherit", env: childEnv });
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", (error) => {
          console.error(`7key: ${error.message}`);
          resolve(127);
        });
      });
    }
    default:
      throw new CiError(`Unknown command: ${command}\n\n${USAGE}`);
  }
}
