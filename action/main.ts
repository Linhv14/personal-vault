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
  console.log(`1PW: loaded ${secrets.length} values into the job environment`);
} catch (error) {
  console.log(`::error::1PW: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
