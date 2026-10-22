import { DEFAULT_SERVER, exportToGithubEnv, fetchSecrets } from "../cli/ci-client.js";

function input(name: string): string {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? "";
}

try {
  const secrets = await fetchSecrets({
    server: input("server") || DEFAULT_SERVER,
    link: input("link"),
    repoKey: input("key"),
  });
  await exportToGithubEnv(secrets);
  process.stdout.write(`7key: loaded ${secrets.length} values into the job environment\n`);
} catch (error) {
  process.stdout.write(
    `::error::7key: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
