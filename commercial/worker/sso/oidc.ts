import { toBase64Url, utf8Encode } from "#core/bytes.js";
import { sha256 } from "#core/primitives.js";
import { normalizeEmail } from "#worker/email-address.js";
import {
  audienceMatches,
  validJwks,
  verifyJws,
  withinLifetime,
  type Jwk,
  type JwksSource,
} from "#worker/jwt.js";
import { fetchJson, type Fetcher } from "./fetcher.js";

export interface ProviderMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  basicAuth: boolean;
}

const CACHE_SECONDS = 3600;
const JWKS_REFRESH_SECONDS = 30;
const CF_CACHE = { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } };

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

const discoveries = new WeakMap<Fetcher, Map<string, Cached<ProviderMetadata>>>();
const keySets = new WeakMap<Fetcher, Map<string, Cached<Jwk[]>>>();

function cacheOf<T>(store: WeakMap<Fetcher, Map<string, Cached<T>>>, fetcher: Fetcher) {
  let cache = store.get(fetcher);
  if (!cache) {
    cache = new Map();
    store.set(fetcher, cache);
  }
  return cache;
}

const seconds = () => Math.floor(Date.now() / 1000);

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeIssuer(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const url = httpsUrl(trimmed);
  if (!url || url.includes("?") || url.includes("#")) {
    return null;
  }
  return trimmed;
}

export async function discover(fetcher: Fetcher, issuer: string): Promise<ProviderMetadata | null> {
  const cache = cacheOf(discoveries, fetcher);
  const cached = cache.get(issuer);
  if (cached && seconds() - cached.fetchedAt < CACHE_SECONDS) {
    return cached.value;
  }
  const base = issuer.replace(/\/$/, "");
  const body = await fetchJson(fetcher, `${base}/.well-known/openid-configuration`, CF_CACHE);
  if (!body) {
    return null;
  }
  const published = body.issuer;
  if (published !== issuer && published !== base && published !== `${base}/`) {
    return null;
  }
  const authorizationEndpoint = httpsUrl(body.authorization_endpoint);
  const tokenEndpoint = httpsUrl(body.token_endpoint);
  const jwksUri = httpsUrl(body.jwks_uri);
  if (typeof published !== "string" || !authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    return null;
  }
  const methods = Array.isArray(body.token_endpoint_auth_methods_supported)
    ? body.token_endpoint_auth_methods_supported
    : ["client_secret_basic"];
  const metadata = {
    issuer: published,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    basicAuth: methods.includes("client_secret_basic") || !methods.includes("client_secret_post"),
  };
  cache.set(issuer, { value: metadata, fetchedAt: seconds() });
  return metadata;
}

export function jwksSource(fetcher: Fetcher, jwksUri: string): JwksSource {
  const cache = cacheOf(keySets, fetcher);
  const load = async () => {
    const body = await fetchJson(fetcher, jwksUri, CF_CACHE);
    const keys = validJwks(body?.keys);
    cache.set(jwksUri, { value: keys, fetchedAt: seconds() });
    return keys;
  };
  return async (kid) => {
    const cached = cache.get(jwksUri);
    if (!cached || seconds() - cached.fetchedAt >= CACHE_SECONDS) {
      return load();
    }
    if (cached.value.some((key) => key.kid === kid)) {
      return cached.value;
    }
    return seconds() - cached.fetchedAt >= JWKS_REFRESH_SECONDS ? load() : cached.value;
  };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(utf8Encode(verifier)));
}

export async function exchangeCode(
  fetcher: Fetcher,
  metadata: ProviderMetadata,
  request: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  },
): Promise<string | null> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: request.code,
    redirect_uri: request.redirectUri,
    code_verifier: request.codeVerifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (metadata.basicAuth) {
    const user = encodeURIComponent(request.clientId);
    const secret = encodeURIComponent(request.clientSecret);
    headers.Authorization = `Basic ${btoa(`${user}:${secret}`)}`;
  } else {
    form.set("client_id", request.clientId);
    form.set("client_secret", request.clientSecret);
  }
  const body = await fetchJson(fetcher, metadata.tokenEndpoint, {
    method: "POST",
    headers,
    body: form.toString(),
  });
  const idToken = body?.id_token;
  return typeof idToken === "string" ? idToken : null;
}

export type IdTokenCheck =
  | { ok: true; email: string; subject: string }
  | { ok: false; code: "sso.failed" | "sso.email_unverified" };

export async function verifyIdToken(
  token: string,
  expected: { issuer: string; clientId: string; nonce: string; now: number; jwks: JwksSource },
): Promise<IdTokenCheck> {
  const failed = { ok: false, code: "sso.failed" } as const;
  const claims = await verifyJws(token, expected.jwks, ["RS256", "ES256"]);
  if (!claims) {
    return failed;
  }
  const { iss, aud, azp, nonce, sub, iat, email, email_verified } = claims;
  if (iss !== expected.issuer || !audienceMatches(aud, [expected.clientId])) {
    return failed;
  }
  if (Array.isArray(aud) && aud.length > 1 && azp !== expected.clientId) {
    return failed;
  }
  if (typeof iat !== "number" || !withinLifetime(claims, expected.now)) {
    return failed;
  }
  if (typeof nonce !== "string" || nonce !== expected.nonce) {
    return failed;
  }
  if (typeof sub !== "string" || sub.length === 0) {
    return failed;
  }
  const address = normalizeEmail(email);
  if (!address) {
    return failed;
  }
  if (email_verified !== true) {
    return { ok: false, code: "sso.email_unverified" };
  }
  return { ok: true, email: address, subject: sub };
}
