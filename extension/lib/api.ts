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

async function request<T>(
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

export async function register(
  email: string,
  record: AccountCryptoRecord,
  registrationToken: string,
  verificationCode?: string,
): Promise<{ accountId: string; token: string }> {
  const result = await request<{ accountId: string; token: string }>("/api/auth/register", {
    method: "POST",
    auth: false,
    extraHeaders: { "X-Registration-Token": registrationToken },
    body: JSON.stringify({ email, ...record, verificationCode }),
  });
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
): Promise<{ token: string; wrappedVaultKey: SealedData }> {
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
): Promise<void> {
  await request("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentAuthKey, ...record }),
  });
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

export async function putItem(id: string, sealed: SealedData): Promise<{ updatedAt: number }> {
  return request(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(sealed) });
}

export async function deleteItem(id: string): Promise<{ deletedAt: number }> {
  return request(`/api/items/${id}`, { method: "DELETE" });
}

export async function createShareLink(
  sealed: SealedData,
  ttlSeconds: number,
  maxViews: number,
): Promise<{ id: string; expiresAt: number }> {
  return request("/api/shares", {
    method: "POST",
    body: JSON.stringify({ ...sealed, ttlSeconds, maxViews }),
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
