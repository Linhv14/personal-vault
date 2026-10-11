/**
 * Gọi Worker. Mọi thứ đi qua đây đều đã mã hoá sẵn — hàm trong file này không
 * bao giờ nhìn thấy plaintext, và cũng không nhận khoá làm tham số.
 */

import type { AccountCryptoRecord, KdfParams, SealedData } from "../../src/core/crypto.js";
import { getLocal, getUnlocked, lock, setToken, type CachedItem } from "./storage.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; extraHeaders?: Record<string, string> } = {},
): Promise<T> {
  const { apiUrl } = await getLocal();
  if (!apiUrl) throw new ApiError("Chưa cấu hình địa chỉ server", 0);

  const headers = new Headers(init.extraHeaders);
  if (init.body) headers.set("Content-Type", "application/json");

  if (init.auth !== false) {
    const session = await getUnlocked();
    if (!session?.token) throw new ApiError("Chưa đăng nhập", 401);
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
  } catch {
    // Phân biệt rõ lỗi mạng với lỗi server: vault vẫn dùng được offline từ cache,
    // nên thông báo phải nói đúng điều đó thay vì làm người dùng tưởng mất dữ liệu.
    throw new ApiError("Không kết nối được server. Dữ liệu đã lưu vẫn xem được.", 0);
  }

  if (response.status === 401 && init.auth !== false) {
    // Session hết hạn ở server: khoá lại để buộc nhập master password, chứ không
    // im lặng thử lại bằng một token đã chết.
    await lock();
    throw new ApiError("Session đã hết hạn, hãy mở lại vault", 401);
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Lỗi ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export async function register(
  email: string,
  record: AccountCryptoRecord,
  registrationToken: string,
): Promise<{ accountId: string; token: string }> {
  const result = await request<{ accountId: string; token: string }>("/api/auth/register", {
    method: "POST",
    auth: false,
    extraHeaders: { "X-Registration-Token": registrationToken },
    body: JSON.stringify({ email, ...record }),
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
  await request("/api/auth/logout", { method: "POST" }).catch(() => {
    // Logout phía server thất bại cũng không sao: xoá khoá cục bộ mới là việc
    // quan trọng, và session sẽ tự hết hạn.
  });
}

export async function changePassword(record: AccountCryptoRecord): Promise<void> {
  await request("/api/auth/change-password", { method: "POST", body: JSON.stringify(record) });
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

/**
 * Đo lệch đồng hồ bằng header `Date` của chính server.
 *
 * TOTP sai nếu đồng hồ máy lệch quá nửa chu kỳ, và đó là lỗi gần như không thể
 * tự chẩn đoán: mã hiện ra trông hoàn toàn bình thường, site chỉ nói "sai mã".
 */
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
