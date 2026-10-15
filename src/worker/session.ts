/**
 * Session handling. Bearer tokens in a header, never cookies.
 *
 * The extension calls the API from a `chrome-extension://` origin, and having no
 * cookies means there is no CSRF surface to worry about — a malicious page
 * cannot make the browser attach your token to its own request.
 */

import { toBase64, toBase64Url, randomBytes, fromBase64 } from "../core/bytes.js";
import type { Env, SessionContext } from "./types.js";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const MAX_SESSIONS_PER_ACCOUNT = 20;

export async function hashToken(token: string): Promise<string> {
  // The token is 32 random bytes, so one SHA-256 round suffices: no dictionary
  // can reach it. Hashing means a leaked database yields no reusable tokens.
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

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(await hashToken(token), accountId, now, expiresAt),
    env.DB.prepare(
      `DELETE FROM sessions
        WHERE account_id = ?
          AND token_hash NOT IN (
            SELECT token_hash FROM sessions
             WHERE account_id = ?
             ORDER BY created_at DESC
             LIMIT ?)`,
    ).bind(accountId, accountId, MAX_SESSIONS_PER_ACCOUNT),
  ]);

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

  // Looked up by primary key on the hash, so no constant-time comparison is
  // needed: SQLite leaks nothing useful through key lookup timing, and an
  // attacker must guess all 32 bytes before a single lookup matches.
  return row ? { accountId: row.account_id, tokenHash } : null;
}

export async function sessionResumeKey(env: Env, tokenHash: string): Promise<string | null> {
  const [, row] = await env.DB.batch<{ resume_key: string | null }>([
    env.DB.prepare(
      "UPDATE sessions SET resume_key = COALESCE(resume_key, ?) WHERE token_hash = ?",
    ).bind(toBase64(randomBytes(32)), tokenHash),
    env.DB.prepare("SELECT resume_key FROM sessions WHERE token_hash = ?").bind(tokenHash),
  ]);
  return row?.results[0]?.resume_key ?? null;
}

export async function revokeSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

/** Revoke every session for an account — used when the master password changes. */
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
