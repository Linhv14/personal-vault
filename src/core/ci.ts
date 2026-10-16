import {
  fromBase64,
  fromBase64Url,
  toBase64,
  toBase64Url,
  utf8Encode,
  type Bytes,
} from "./bytes.js";
import type { SealedData } from "./crypto.js";
import { unwrapForRecipient, type Identity, type WrappedForRecipient } from "./identity.js";
import { openWithEnvironmentKey, type SecretContent } from "./projects.js";

const REPO_KEY_PREFIX = "1pw1";
const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const GITHUB_ENVIRONMENT = /^[A-Za-z0-9._ -]{1,255}$/;

export interface LinkRule {
  repository: string;
  branch: string | null;
  githubEnvironment: string | null;
}

export interface GithubClaims {
  repository: string;
  ref: string;
  environment?: string;
  event_name: string;
}

export function encodeRepoKey(identity: Identity): string {
  return [
    REPO_KEY_PREFIX,
    toBase64Url(fromBase64(identity.publicKey)),
    toBase64Url(identity.privateKey),
  ].join(".");
}

export function decodeRepoKey(text: string): Identity {
  const [prefix, publicKey, privateKey] = text.trim().split(".");
  if (prefix !== REPO_KEY_PREFIX || !publicKey || !privateKey) {
    throw new Error("Not a 7key repository key");
  }
  return { publicKey: toBase64(fromBase64Url(publicKey)), privateKey: fromBase64Url(privateKey) };
}

export function linkReference(orgId: string, linkId: string): string {
  return `${orgId}.${linkId}`;
}

export function parseLinkReference(text: string): { orgId: string; linkId: string } | null {
  const [orgId, linkId, extra] = text.trim().split(".");
  return orgId && linkId && extra === undefined ? { orgId, linkId } : null;
}

export function linkKeyContext(linkId: string, generation: number): Bytes {
  return utf8Encode(`personal-vault/link-key/${linkId}/${generation}`);
}

export function isRepository(value: unknown): value is string {
  return typeof value === "string" && REPOSITORY.test(value);
}

export function isBranch(value: unknown): value is string {
  return typeof value === "string" && BRANCH.test(value) && !value.includes("..");
}

export function isGithubEnvironment(value: unknown): value is string {
  return typeof value === "string" && GITHUB_ENVIRONMENT.test(value);
}

export function ruleAllows(rule: LinkRule, claims: GithubClaims): boolean {
  if (claims.repository.toLowerCase() !== rule.repository.toLowerCase()) return false;
  if (claims.event_name === "pull_request_target") return false;
  if (rule.branch === null && rule.githubEnvironment === null) return false;
  if (rule.branch !== null && claims.ref !== `refs/heads/${rule.branch}`) return false;
  if (rule.githubEnvironment !== null && claims.environment !== rule.githubEnvironment) {
    return false;
  }
  return true;
}

export interface CiResponse {
  projectId: string;
  environmentId: string;
  generation: number;
  wrappedKey: WrappedForRecipient;
  secrets: { id: string; sealed: SealedData }[];
}

export async function openCiResponse(
  repoKey: string,
  linkId: string,
  response: CiResponse,
): Promise<SecretContent[]> {
  const environmentKey = new Uint8Array(
    await unwrapForRecipient(
      decodeRepoKey(repoKey),
      response.wrappedKey,
      linkKeyContext(linkId, response.generation),
    ),
  );
  const opened = await Promise.all(
    response.secrets.map(({ id, sealed }) =>
      openWithEnvironmentKey(
        environmentKey,
        {
          projectId: response.projectId,
          generation: response.generation,
          environmentId: response.environmentId,
          secretId: id,
        },
        sealed,
      ),
    ),
  );
  return opened.sort((a, b) => a.name.localeCompare(b.name));
}
