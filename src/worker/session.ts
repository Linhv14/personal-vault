/**
 * Quản lý session. Dùng Bearer token trong header, không dùng cookie.
 *
 * Lý do: extension gọi API từ origin `chrome-extension://...`, và không có cookie
 * nghĩa là không có bề mặt CSRF nào để lo — một trang web độc hại không thể bắt
 * browser gắn token của bạn vào request của nó.
 */

import { toBase64, toBase64Url, randomBytes, fromBase64 } from "../core/bytes.js";
import type { Env, SessionContext } from "./types.js";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày

export async function hashToken(token: string): Promise<string> {
  // Token là 32 byte ngẫu nhiên nên một vòng SHA-256 là đủ: không có từ điển nào
  // dò được nó. Hash để nếu DB bị đọc thì token trong đó không dùng lại được.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64(new Uint8Array(digest));
}

export async function createSession(
  env: Env,
  accountId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const token = toBase64Url(randomBytes(32));
  const expiresAt = now + SESSION_TTL_SECONDS;

  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await hashToken(token), accountId, now, expiresAt)
    .run();

  return { token, expiresAt };
}

export async function resolveSession(
  env: Env,
  authorization: string | undefined,
  now = Math.floor(Date.now() / 1000),
): Promise<SessionContext | null> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]?.trim();
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    "SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(tokenHash, now)
    .first<{ account_id: string }>();

  // Tra trực tiếp bằng hash làm khoá chính nên không cần so sánh timing-safe:
  // SQLite không tiết lộ thông tin qua thời gian tra khoá chính, và kẻ tấn công
  // cần đoán đúng toàn bộ 32 byte mới có một lượt tra khớp.
  return row ? { accountId: row.account_id, tokenHash } : null;
}

export async function revokeSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

/** Thu hồi mọi session của account — dùng khi đổi master password. */
export async function revokeAllSessions(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId).run();
}

export function isBase64(value: unknown, maxBytes = 4096): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return fromBase64(value).length <= maxBytes;
  } catch {
    return false;
  }
}
