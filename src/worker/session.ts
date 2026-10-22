import { sha256 } from "../core/primitives.js";
import { toBase64, toBase64Url, randomBytes, utf8Encode } from "../core/bytes.js";
import type { Env, SessionContext } from "./types.js";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 14 * 24 * 60 * 60;
const TOUCH_INTERVAL_SECONDS = 5 * 60;
const MAX_SESSIONS_PER_ACCOUNT = 20;

export async function hashToken(token: string): Promise<string> {
  return toBase64(await sha256(utf8Encode(token)));
}

export function decoySession(now: number): { token: string; expiresAt: number } {
  return { token: toBase64Url(randomBytes(32)), expiresAt: now + SESSION_TTL_SECONDS };
}

export async function createSession(
  env: Env,
  accountId: string,
  now = Math.floor(Date.now() / 1000),
  deviceLabel: string | null = null,
): Promise<{ token: string; expiresAt: number }> {
  const { token, expiresAt } = decoySession(now);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen_at, device_label)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await hashToken(token), accountId, now, expiresAt, now, deviceLabel),
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
  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT account_id, last_seen_at FROM sessions
      WHERE token_hash = ? AND expires_at > ? AND (last_seen_at IS NULL OR last_seen_at > ?)`,
  )
    .bind(tokenHash, now, now - SESSION_IDLE_SECONDS)
    .first<{ account_id: string; last_seen_at: number | null }>();
  if (row && (row.last_seen_at === null || now - row.last_seen_at >= TOUCH_INTERVAL_SECONDS)) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash)
      .run();
  }

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

export async function revokeAllSessions(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId).run();
}

export async function revokeOtherSessions(
  env: Env,
  accountId: string,
  keepTokenHash: string,
): Promise<number> {
  const result = await env.DB.prepare(
    "DELETE FROM sessions WHERE account_id = ? AND token_hash != ?",
  )
    .bind(accountId, keepTokenHash)
    .run();
  return result.meta.changes;
}

export async function sessionId(tokenHash: string): Promise<string> {
  const digest = await sha256(utf8Encode(`session-id:${tokenHash}`));
  return toBase64Url(digest.slice(0, 16));
}

export interface SessionSummary {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  current: boolean;
}

export async function listSessions(
  env: Env,
  accountId: string,
  currentTokenHash: string,
  now = Math.floor(Date.now() / 1000),
): Promise<SessionSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT token_hash, device_label, created_at, last_seen_at FROM sessions
      WHERE account_id = ? AND expires_at > ? AND (last_seen_at IS NULL OR last_seen_at > ?)`,
  )
    .bind(accountId, now, now - SESSION_IDLE_SECONDS)
    .all<{
      token_hash: string;
      device_label: string | null;
      created_at: number;
      last_seen_at: number | null;
    }>();
  const sessions = await Promise.all(
    results.map(async (row) => ({
      id: await sessionId(row.token_hash),
      label: row.device_label ?? "",
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      current: row.token_hash === currentTokenHash,
    })),
  );
  return sessions.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt),
  );
}

export async function revokeSessionById(env: Env, accountId: string, id: string): Promise<boolean> {
  const { results } = await env.DB.prepare("SELECT token_hash FROM sessions WHERE account_id = ?")
    .bind(accountId)
    .all<{ token_hash: string }>();
  for (const row of results) {
    if ((await sessionId(row.token_hash)) === id) {
      await revokeSession(env, row.token_hash);
      return true;
    }
  }
  return false;
}

export async function noteDevice(
  env: Env,
  accountId: string,
  label: string,
  now: number,
): Promise<"first" | "known" | "new"> {
  const [known, inserted] = await env.DB.batch<{ known: number }>([
    env.DB.prepare("SELECT COUNT(*) AS known FROM known_devices WHERE account_id = ?").bind(
      accountId,
    ),
    env.DB.prepare(
      `INSERT INTO known_devices (account_id, label, first_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(account_id, label) DO NOTHING`,
    ).bind(accountId, label, now),
  ]);
  if (!inserted?.meta.changes) {
    return "known";
  }
  return (known?.results[0]?.known ?? 0) === 0 ? "first" : "new";
}
