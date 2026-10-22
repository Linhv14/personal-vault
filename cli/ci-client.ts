import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { openCiResponse, parseLinkReference, type CiResponse } from "../src/core/ci.js";
import type { SecretContent } from "../src/core/projects.js";

export { DEFAULT_SERVER } from "../src/core/brand.js";

export interface FetchOptions {
  server: string;
  link: string;
  repoKey: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export class CiError extends Error {}

export async function githubIdToken(
  audience: string,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<string> {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) {
    throw new CiError(
      "No GitHub OIDC token. Run inside GitHub Actions with `permissions: id-token: write`.",
    );
  }
  const target = new URL(url);
  target.searchParams.set("audience", audience);
  const response = await request(target, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) {
    throw new CiError(`GitHub refused an OIDC token (${response.status})`);
  }
  const { value } = (await response.json()) as { value?: string };
  if (!value) {
    throw new CiError("GitHub returned an empty OIDC token");
  }
  return value;
}

export async function fetchSecrets(options: FetchOptions): Promise<SecretContent[]> {
  const request = options.fetch ?? fetch;
  const reference = parseLinkReference(options.link);
  if (!reference) {
    throw new CiError("The link should look like <organization>.<link>");
  }
  const server = new URL(options.server).origin;
  const token = await githubIdToken(server, options.env, request);
  const response = await request(`${server}/api/ci/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ link: options.link }),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new CiError(`7key refused the request (${response.status}): ${error ?? "unknown error"}`);
  }
  return openCiResponse(options.repoKey, reference.linkId, (await response.json()) as CiResponse);
}

export function maskCommands(secrets: SecretContent[]): string[] {
  return secrets
    .filter((secret) => secret.kind !== "variable")
    .flatMap((secret) => secret.value.split(/\r?\n/))
    .filter((line) => line.trim().length > 0)
    .map((line) => `::add-mask::${line}`);
}

export function githubEnvBlock(secrets: SecretContent[]): string {
  return secrets
    .map(({ name, value }) => {
      const delimiter = `SEVENKEY_${randomBytes(12).toString("hex")}`;
      return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    })
    .join("");
}

export async function exportToGithubEnv(
  secrets: SecretContent[],
  env: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (line) => console.log(line),
): Promise<void> {
  const file = env.GITHUB_ENV;
  if (!file) {
    throw new CiError("GITHUB_ENV is not set; this only works inside GitHub Actions");
  }
  for (const command of maskCommands(secrets)) {
    write(command);
  }
  await appendFile(file, githubEnvBlock(secrets));
}
