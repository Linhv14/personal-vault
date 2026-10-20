/**
 * Worker client. Everything passing through here is already encrypted — no
 * function in this file sees plaintext or takes a key.
 */

import type { AccountCryptoRecord, KdfParams, SealedData } from "../../src/core/crypto.js";
import { getLocal, getUnlocked, lock, setToken, type CachedItem } from "./storage.js";

/**
 * `status: 0` means the request never reached the server. The UI distinguishes
 * it from a real failure because the vault still works offline from its cache.
 */
export class ApiError extends Error {
  constructor(
    /** i18n key, e.g. `error.api.offline` or `error.auth.invalid_credentials`. */
    readonly messageKey: string,
    readonly status: number,
    readonly params: Record<string, string | number> = {},
  ) {
    super(messageKey);
    this.name = "ApiError";
  }
}

interface ServerError {
  code?: string;
  error?: string;
  params?: Record<string, string | number>;
}

export async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; extraHeaders?: Record<string, string> } = {},
): Promise<T> {
  const { apiUrl } = await getLocal();
  if (!apiUrl) throw new ApiError("error.api.no_server", 0);

  const headers = new Headers(init.extraHeaders);
  if (init.body) headers.set("Content-Type", "application/json");

  if (init.auth !== false) {
    const session = await getUnlocked();
    if (!session?.token) throw new ApiError("error.api.not_signed_in", 401);
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("error.api.offline", 0);
  }

  if (response.status === 401 && init.auth !== false) {
    // The server dropped the session: lock so the user re-derives the key,
    // rather than silently retrying with a dead token.
    await lock();
    throw new ApiError("error.api.session_expired", 401);
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const { code, params } = (body ?? {}) as ServerError;
    throw new ApiError(
      code ? `error.${code}` : "error.api.generic",
      response.status,
      params ?? { status: response.status },
    );
  }
  return body as T;
}

export async function resumeKey(token: string): Promise<string> {
  const { resumeKey } = await request<{ resumeKey: string }>("/api/auth/resume-key", {
    auth: false,
    extraHeaders: { Authorization: `Bearer ${token}` },
  });
  return resumeKey;
}

export function asSession(token: string) {
  return { auth: false, extraHeaders: { Authorization: `Bearer ${token}` } } as const;
}

export async function fetchLogo(domain: string): Promise<Blob | null> {
  const [{ apiUrl }, session] = await Promise.all([getLocal(), getUnlocked()]);
  if (!apiUrl || !session?.token) return null;
  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/api/logo?domain=${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${session.token}` }, cache: "no-store" },
    );
    if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

export async function register(
  email: string,
  record: AccountCryptoRecord,
  registrationToken: string,
  verificationCode?: string,
  inviteId?: string,
): Promise<{ accountId: string; token: string; orgId?: string }> {
  const result = await request<{ accountId: string; token: string; orgId?: string }>(
    "/api/auth/register",
    {
      method: "POST",
      auth: false,
      extraHeaders: { "X-Registration-Token": registrationToken },
      body: JSON.stringify({ email, ...record, verificationCode, inviteId }),
    },
  );
  await setToken(result.token);
  return result;
}

export async function prelogin(email: string): Promise<KdfParams> {
  const result = await request<{ kdf: KdfParams }>("/api/auth/prelogin", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email }),
  });
  return result.kdf;
}

export async function login(
  email: string,
  authKey: string,
): Promise<{ token: string; wrappedVaultKey: SealedData; upgradeKdf?: boolean }> {
  return request("/api/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, authKey }),
  });
}

export async function logout(): Promise<void> {
  // A failed server-side logout is not worth surfacing: clearing local keys is
  // what matters, and the session expires on its own.
  await request("/api/auth/logout", { method: "POST" }).catch(() => {});
}

export async function changePassword(
  currentAuthKey: string,
  record: AccountCryptoRecord,
  options: { keepSession?: boolean; token?: string } = {},
): Promise<void> {
  await request("/api/auth/change-password", {
    method: "POST",
    ...(options.token ? asSession(options.token) : {}),
    body: JSON.stringify({ currentAuthKey, ...record, keepSession: options.keepSession }),
  });
}

export interface SessionInfo {
  id: string;
  label: string;
  kind: "browser" | "cli" | "ci" | "unknown";
  createdAt: number;
  lastSeenAt: number | null;
  current: boolean;
}

export async function listSessions(): Promise<SessionInfo[]> {
  return (await request<{ sessions: SessionInfo[] }>("/api/auth/sessions")).sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function revokeOtherSessions(): Promise<void> {
  await request("/api/auth/sessions/revoke-others", { method: "POST" });
}

export async function deleteAccount(currentAuthKey: string): Promise<void> {
  await request("/api/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ currentAuthKey }),
  });
}

export interface ServerConfig {
  registrationOpen: boolean;
  emailVerification: boolean;
}

const SERVER_CONFIG_TIMEOUT_MS = 3000;

export async function serverConfig(apiUrl: string): Promise<ServerConfig> {
  if (!apiUrl) return { registrationOpen: false, emailVerification: false };
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/config`, {
      signal: AbortSignal.timeout(SERVER_CONFIG_TIMEOUT_MS),
    });
    const body = (await response.json()) as { registration?: string; emailVerification?: boolean };
    return {
      registrationOpen: body.registration === "open",
      emailVerification: body.emailVerification === true,
    };
  } catch {
    return { registrationOpen: false, emailVerification: false };
  }
}

export async function requestVerificationCode(
  apiUrl: string,
  email: string,
  locale: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale }),
    });
  } catch {
    throw new ApiError("error.api.offline", 0);
  }
  if (!response.ok) {
    const { code, params } = ((await response.json().catch(() => null)) ?? {}) as ServerError;
    throw new ApiError(code ? `error.${code}` : "error.api.generic", response.status, params ?? {});
  }
}

export async function fetchItems(
  since: number,
): Promise<{ serverTime: number; items: CachedItem[] }> {
  return request(`/api/items?since=${since}`);
}

export async function putItem(
  id: string,
  sealed: SealedData,
  ifUpdatedAt?: number,
): Promise<{ updatedAt: number }> {
  const condition = ifUpdatedAt === undefined ? "" : `?ifUpdatedAt=${ifUpdatedAt}`;
  return request(`/api/items/${id}${condition}`, { method: "PUT", body: JSON.stringify(sealed) });
}

export async function createItems(
  items: (SealedData & { id: string })[],
): Promise<{ updatedAt: number; created: string[] }> {
  return request("/api/items/batch", { method: "POST", body: JSON.stringify({ items }) });
}

export async function deleteItem(id: string): Promise<{ deletedAt: number }> {
  return request(`/api/items/${id}`, { method: "DELETE" });
}

export interface ShareOptions {
  ttlSeconds: number;
  maxViews: number | null;
  recipients: string[];
}

export interface CreatedShareLink {
  id: string;
  expiresAt: number;
  revokeToken: string;
}

export async function createShareLink(
  sealed: SealedData,
  { ttlSeconds, maxViews, recipients }: ShareOptions,
): Promise<CreatedShareLink> {
  return request("/api/shares", {
    method: "POST",
    body: JSON.stringify({
      ...sealed,
      ttlSeconds,
      maxViews,
      ...(recipients.length > 0 && { recipients }),
    }),
  });
}

export type ShareStatus =
  | { id: string; active: false }
  | { id: string; active: true; expiresAt: number; viewsLeft: number | null };

export async function shareStatuses(
  shares: { id: string; revokeToken: string }[],
): Promise<ShareStatus[]> {
  if (shares.length === 0) return [];
  const result = await request<{ shares: ShareStatus[] }>("/api/shares/status", {
    method: "POST",
    body: JSON.stringify({ shares }),
  });
  return result.shares;
}

export async function revokeShareLink(id: string, revokeToken: string): Promise<void> {
  await request(`/api/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    extraHeaders: { "X-Revoke-Token": revokeToken },
  });
}

export async function measureClockSkew(): Promise<number | null> {
  const { apiUrl } = await getLocal();
  if (!apiUrl) return null;
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/time`);
    const { serverTime } = (await response.json()) as { serverTime: number };
    return serverTime - Math.floor(Date.now() / 1000);
  } catch {
    return null;
  }
}
