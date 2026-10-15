import { spawn } from "node:child_process";
import { formatDotenv } from "../src/core/projects.js";
import { CiError, DEFAULT_SERVER, exportToGithubEnv, fetchSecrets } from "./ci-client.js";

const USAGE = `Usage: 1pw <command> [options]

  run -- <command…>   Run a command with the linked secrets in its environment
  env                 Export the linked secrets to later GitHub Actions steps
  dotenv              Print the linked secrets as a .env file

Options
  --link <ref>        Repository link, as shown in the 1PW console (or ONEPW_LINK)
  --server <url>      1PW server (or ONEPW_SERVER, default ${DEFAULT_SERVER})

The repository key is read from ONEPW_KEY, which should be a GitHub secret.
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
    link: env.ONEPW_LINK,
    server: env.ONEPW_SERVER ?? DEFAULT_SERVER,
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
  const { command, link, server, rest } = parseArgs(argv, env);
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (!link) throw new CiError("Pass --link or set ONEPW_LINK");
  const repoKey = env.ONEPW_KEY;
  if (!repoKey) throw new CiError("Set ONEPW_KEY to the repository key from the 1PW console");
  const secrets = await fetchSecrets({ server, link, repoKey, env });

  switch (command) {
    case "dotenv":
      process.stdout.write(formatDotenv(secrets));
      return 0;
    case "env":
      await exportToGithubEnv(secrets, env);
      console.log(`1PW: exported ${secrets.length} values`);
      return 0;
    case "run": {
      const [program, ...args] = rest;
      if (!program) throw new CiError("Nothing to run: add -- <command>");
      const childEnv = { ...env };
      delete childEnv.ONEPW_KEY;
      for (const { name, value } of secrets) childEnv[name] = value;
      return new Promise((resolve) => {
        const child = spawn(program, args, { stdio: "inherit", env: childEnv });
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", (error) => {
          console.error(`1PW: ${error.message}`);
          resolve(127);
        });
      });
    }
    default:
      throw new CiError(`Unknown command: ${command}\n\n${USAGE}`);
  }
}
