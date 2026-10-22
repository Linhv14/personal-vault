import { randomBytes, toBase64Url, utf8Encode } from "#core/bytes.js";
import { isKdfParams, isSealedData, type KdfParams, type SealedData } from "#core/crypto.js";
import { isBoolean, isFiniteNumber, isPlainObject, isString } from "#core/json.js";
import { sha256 } from "#core/primitives.js";
import { ApiError, requestChecked } from "#ext/lib/api.js";
import type { DecryptionOption } from "#commercial/core/sso-model.js";

export interface PreparedSso {
  orgName: string;
  identifier: string | null;
  authorizeUrl: string;
}

export type SsoSession =
  | {
      status: "signed_in";
      email: string;
      orgId: string;
      kdf: KdfParams;
      token: string;
      wrappedVaultKey: SealedData;
    }
  | { status: "register"; email: string; orgName: string; registrationGrant: string };

async function post(apiUrl: string, path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("error.api.offline", 0);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isPlainObject(value) && isString(value.code) ? value.code : null;
    const params = isPlainObject(value) && isPlainObject(value.params) ? value.params : {};
    throw new ApiError(
      code ? `error.${code}` : "error.api.generic",
      response.status,
      code ? (params as Record<string, string | number>) : { status: response.status },
    );
  }
  return value;
}

export function newVerifier(): string {
  return toBase64Url(randomBytes(32));
}

export async function challengeOf(verifier: string): Promise<string> {
  return toBase64Url(await sha256(utf8Encode(verifier)));
}

export async function prepareSso(
  apiUrl: string,
  lookup: string,
  returnTo: string,
  verifier: string,
): Promise<PreparedSso> {
  const value = lookup.trim();
  const body = await post(apiUrl, "/api/sso/prepare", {
    ...(value.includes("@") ? { email: value } : { identifier: value }),
    returnTo,
    clientChallenge: await challengeOf(verifier),
  });
  if (!isPlainObject(body) || !isString(body.orgName) || !isString(body.authorizeUrl)) {
    throw new ApiError("error.api.bad_response", 200);
  }
  if (!new URL(body.authorizeUrl).protocol.startsWith("https")) {
    throw new ApiError("error.api.bad_response", 200);
  }
  return {
    orgName: body.orgName,
    identifier: isString(body.identifier) ? body.identifier : null,
    authorizeUrl: body.authorizeUrl,
  };
}

export async function startSsoSession(
  apiUrl: string,
  grant: string,
  verifier: string,
  locale: string,
): Promise<SsoSession> {
  const body = await post(apiUrl, "/api/sso/session", {
    grant,
    clientVerifier: verifier,
    locale,
  });
  if (!isPlainObject(body) || !isString(body.email)) {
    throw new ApiError("error.api.bad_response", 200);
  }
  if (
    body.status === "signed_in" &&
    isString(body.orgId) &&
    isKdfParams(body.kdf) &&
    isString(body.token) &&
    isSealedData(body.wrappedVaultKey)
  ) {
    return {
      status: "signed_in",
      email: body.email,
      orgId: body.orgId,
      kdf: body.kdf,
      token: body.token,
      wrappedVaultKey: body.wrappedVaultKey,
    };
  }
  if (body.status === "register" && isString(body.orgName) && isString(body.registrationGrant)) {
    return {
      status: "register",
      email: body.email,
      orgName: body.orgName,
      registrationGrant: body.registrationGrant,
    };
  }
  throw new ApiError("error.api.bad_response", 200);
}

export interface SsoDomainView {
  domain: string;
  record: string;
  verified: boolean;
  verifiedAt: number | null;
  checkedAt: number | null;
}

export interface SsoOverview {
  available: boolean;
  plan: string;
  license:
    | { status: "valid" | "expired"; licensee: string; seats: number; expiresAt: number }
    | { status: "missing" | "invalid" };
  identifier: string | null;
  redirectUri: string;
  decryptionOptions: DecryptionOption[];
  provider: {
    issuer: string;
    clientId: string;
    hasSecret: boolean;
    enabled: boolean;
    decryption: DecryptionOption;
  } | null;
  policies: { requireSso: boolean; singleOrg: boolean };
  domains: SsoDomainView[];
}

function isOverview(value: unknown): value is SsoOverview {
  return (
    isPlainObject(value) &&
    isBoolean(value.available) &&
    isString(value.redirectUri) &&
    isPlainObject(value.license) &&
    isPlainObject(value.policies) &&
    Array.isArray(value.domains) &&
    value.domains.every(
      (entry) =>
        isPlainObject(entry) &&
        isString(entry.domain) &&
        isString(entry.record) &&
        isBoolean(entry.verified),
    ) &&
    (value.identifier === null || isString(value.identifier)) &&
    (value.provider === null || isPlainObject(value.provider)) &&
    (value.license.status !== "valid" || isFiniteNumber(value.license.expiresAt))
  );
}

const base = (orgId: string) => `/api/orgs/${orgId}/sso`;

const send = (orgId: string, path: string, method: string, body?: unknown) =>
  requestChecked(`${base(orgId)}${path}`, isOverview, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const ssoOverview = (orgId: string) => requestChecked(base(orgId), isOverview);

export const setSsoIdentifier = (orgId: string, identifier: string) =>
  send(orgId, "/identifier", "PUT", { identifier });

export const addSsoDomain = (orgId: string, domain: string) =>
  send(orgId, "/domains", "POST", { domain });

export const verifySsoDomain = (orgId: string, domain: string) =>
  send(orgId, `/domains/${encodeURIComponent(domain)}/verify`, "POST");

export const removeSsoDomain = (orgId: string, domain: string) =>
  send(orgId, `/domains/${encodeURIComponent(domain)}`, "DELETE");

export const saveSsoProvider = (
  orgId: string,
  provider: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    enabled: boolean;
    decryption: DecryptionOption;
  },
) => send(orgId, "/provider", "PUT", provider);

export const saveSsoPolicies = (
  orgId: string,
  policies: { requireSso: boolean; singleOrg: boolean },
) => send(orgId, "/policies", "PUT", policies);
