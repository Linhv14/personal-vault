export const SSO_FEATURE = "sso";
export const ENTERPRISE_PLAN = "enterprise";
export const MAX_SSO_DOMAINS = 20;
export const DOMAIN_RECORD_PREFIX = "7key-verify=";
export const OFFICIAL_EXTENSION_ID = "fhfkfaaijhliafkfdnpijlbjecimacmb";
export const SSO_SCOPES = "openid email profile";

export const DECRYPTION_OPTIONS = ["master_password"] as const;
export type DecryptionOption = (typeof DECRYPTION_OPTIONS)[number];

export function isDecryptionOption(value: unknown): value is DecryptionOption {
  return DECRYPTION_OPTIONS.some((option) => option === value);
}

const IDENTIFIER = /^[a-z0-9-]{3,32}$/;

export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const identifier = value.trim().toLowerCase();
  return IDENTIFIER.test(identifier) ? identifier : null;
}

export function domainRecord(token: string): string {
  return `${DOMAIN_RECORD_PREFIX}${token}`;
}

const EXTENSION_ID = /^[a-p]{32}$/;

export function extensionIds(configured: string | undefined): string[] {
  const listed = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => EXTENSION_ID.test(entry));
  return listed.length > 0 ? listed : [OFFICIAL_EXTENSION_ID];
}

export function extensionReturnTarget(extensionId: string): string {
  return `https://${extensionId}.chromiumapp.org/`;
}

export function webReturnTarget(origin: string): string {
  return `${origin}/app/`;
}

export function returnTargets(origin: string, configuredExtensions: string | undefined): string[] {
  return [
    webReturnTarget(origin),
    ...extensionIds(configuredExtensions).map(extensionReturnTarget),
  ];
}

export function isAllowedReturn(value: unknown, targets: readonly string[]): value is string {
  return typeof value === "string" && targets.includes(value);
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/sso/callback`;
}
export interface SsoOutcome {
  grant?: string;
  error?: string;
}

export function readOutcome(url: string): SsoOutcome | null {
  let hash: string;
  try {
    hash = new URL(url).hash.replace(/^#/, "");
  } catch {
    return null;
  }
  const params = new URLSearchParams(hash);
  const grant = params.get("sso_grant");
  const error = params.get("sso_error");
  if (grant) {
    return { grant };
  }
  return error ? { error } : null;
}
