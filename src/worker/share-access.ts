import { timingSafeEqual, utf8Encode } from "#core/bytes.js";
import { shareAccessEmail, type EmailLocale } from "./emails.js";
import { keyedHash } from "./keyed-hash.js";
import type { Mailer } from "./mailer.js";
import { CODE_MAX_ATTEMPTS, CODE_RESEND_COOLDOWN_SECONDS, generateCode } from "./one-time-code.js";
import type { Env } from "./types.js";

const SHARE_CODE_TTL_SECONDS = 10 * 60;
export const MAX_RECIPIENTS = 10;

export function recipientHash(env: Env, email: string): Promise<string> {
  return keyedHash(env.EMAIL_PROBE_SECRET, `share-recipient:${email}`);
}

function codeHash(env: Env, shareId: string, emailHash: string, code: string): Promise<string> {
  return keyedHash(env.EMAIL_PROBE_SECRET, `share-code:${shareId}:${emailHash}:${code}`);
}

export interface ShareCodeRequest {
  shareId: string;
  email: string;
  locale: EmailLocale;
  siteUrl: string;
}

export async function sendShareCode(
  env: Env,
  mailer: Mailer,
  { shareId, email, locale, siteUrl }: ShareCodeRequest,
  timestamp: number,
): Promise<void> {
  const emailHash = await recipientHash(env, email);
  const allowed = await env.DB.prepare(
    `SELECT 1 FROM share_recipients r JOIN shares s ON s.id = r.share_id
      WHERE r.share_id = ? AND r.email_hash = ? AND s.expires_at > ? AND s.view_count < s.max_views`,
  )
    .bind(shareId, emailHash, timestamp)
    .first();
  if (!allowed) {
    return;
  }

  const previous = await env.DB.prepare(
    "SELECT sent_at FROM share_codes WHERE share_id = ? AND email_hash = ?",
  )
    .bind(shareId, emailHash)
    .first<{ sent_at: number }>();
  if (previous && timestamp - previous.sent_at < CODE_RESEND_COOLDOWN_SECONDS) {
    return;
  }

  const code = generateCode();
  await env.DB.prepare(
    `INSERT INTO share_codes (share_id, email_hash, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(share_id, email_hash) DO UPDATE
       SET code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0,
           sent_at = excluded.sent_at`,
  )
    .bind(
      shareId,
      emailHash,
      await codeHash(env, shareId, emailHash, code),
      timestamp + SHARE_CODE_TTL_SECONDS,
      timestamp,
    )
    .run();

  await mailer.send({
    to: email,
    ...shareAccessEmail({ locale, siteUrl }, code),
  });
}

export type ShareCodeResult = "ok" | "invalid" | "expired";

export async function consumeShareCode(
  env: Env,
  shareId: string,
  email: string,
  code: string,
  timestamp: number,
): Promise<ShareCodeResult> {
  const emailHash = await recipientHash(env, email);
  const row = await env.DB.prepare(
    `UPDATE share_codes SET attempts = attempts + 1
      WHERE share_id = ? AND email_hash = ? AND expires_at > ? AND attempts < ?
      RETURNING code_hash`,
  )
    .bind(shareId, emailHash, timestamp, CODE_MAX_ATTEMPTS)
    .first<{ code_hash: string }>();
  if (!row) {
    return "expired";
  }

  const expected = utf8Encode(row.code_hash);
  const provided = utf8Encode(await codeHash(env, shareId, emailHash, code));
  if (!timingSafeEqual(provided, expected)) {
    return "invalid";
  }

  const consumed = await env.DB.prepare(
    "DELETE FROM share_codes WHERE share_id = ? AND email_hash = ? RETURNING share_id",
  )
    .bind(shareId, emailHash)
    .first();
  return consumed ? "ok" : "expired";
}
