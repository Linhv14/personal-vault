import { fromBase64Url, utf8Decode, utf8Encode, type Bytes } from "../core/bytes.js";
import type { GithubClaims } from "../core/ci.js";
import { isPlainObject } from "../core/json.js";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 8192;

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

export type JwksSource = () => Promise<Jwk[]>;

function isJwk(value: unknown): value is Jwk {
  return (
    isPlainObject(value) &&
    typeof value.kid === "string" &&
    typeof value.kty === "string" &&
    typeof value.n === "string" &&
    typeof value.e === "string"
  );
}

export function validJwks(value: unknown): Jwk[] {
  return Array.isArray(value) ? value.filter(isJwk) : [];
}

export const githubJwks: JwksSource = async () => {
  const cached: RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } } = {
    cf: { cacheTtl: 3600, cacheEverything: true },
  };
  const response = await fetch(JWKS_URL, cached);
  if (!response.ok) {
    return [];
  }
  const body: unknown = await response.json();
  return validJwks(isPlainObject(body) ? body.keys : null);
};

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(utf8Decode(fromBase64Url(part)));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function audienceMatches(aud: unknown, expected: readonly string[]): boolean {
  const given = Array.isArray(aud) ? aud : [aud];
  return given.some((entry) => typeof entry === "string" && expected.includes(entry));
}

export async function verifyGithubToken(
  token: string,
  options: { audience: string | readonly string[]; issuer?: string; now: number; jwks: JwksSource },
): Promise<GithubClaims | null> {
  if (token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) {
    return null;
  }
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") {
    return null;
  }

  const jwk = (await options.jwks()).find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    return null;
  }
  let signature: Bytes;
  try {
    signature = fromBase64Url(signaturePart);
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    utf8Encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) {
    return null;
  }

  const { iss, aud, exp, nbf, repository, ref, environment, event_name } = payload;
  if (iss !== (options.issuer ?? GITHUB_ISSUER)) {
    return null;
  }
  const audiences = typeof options.audience === "string" ? [options.audience] : options.audience;
  if (!audienceMatches(aud, audiences)) {
    return null;
  }
  if (typeof exp !== "number" || exp + CLOCK_SKEW_SECONDS < options.now) {
    return null;
  }
  if (typeof nbf === "number" && nbf - CLOCK_SKEW_SECONDS > options.now) {
    return null;
  }
  if (typeof repository !== "string" || typeof ref !== "string") {
    return null;
  }
  if (typeof event_name !== "string") {
    return null;
  }
  return {
    repository,
    ref,
    event_name,
    ...(typeof environment === "string" && { environment }),
  };
}
