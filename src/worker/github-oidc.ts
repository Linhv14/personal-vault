import type { GithubClaims } from "#core/ci.js";
import { isPlainObject } from "#core/json.js";
import { audienceMatches, validJwks, verifyJws, withinLifetime, type JwksSource } from "./jwt.js";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;

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

export async function verifyGithubToken(
  token: string,
  options: { audience: string | readonly string[]; issuer?: string; now: number; jwks: JwksSource },
): Promise<GithubClaims | null> {
  const payload = await verifyJws(token, options.jwks, ["RS256"]);
  if (!payload) {
    return null;
  }
  const { iss, aud, repository, ref, environment, event_name } = payload;
  if (iss !== (options.issuer ?? GITHUB_ISSUER)) {
    return null;
  }
  const audiences = typeof options.audience === "string" ? [options.audience] : options.audience;
  if (!audienceMatches(aud, audiences)) {
    return null;
  }
  if (!withinLifetime({ exp: payload.exp, nbf: payload.nbf }, options.now)) {
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
