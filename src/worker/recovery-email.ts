import { timingSafeEqual, utf8Encode } from "../core/bytes.js";
import { recoveryCodeEmail, type EmailLocale } from "./emails.js";
import { keyedHash } from "./keyed-hash.js";
import type { Mailer } from "./mailer.js";
import { CODE_MAX_ATTEMPTS, CODE_RESEND_COOLDOWN_SECONDS, generateCode } from "./one-time-code.js";
import type { Env } from "./types.js";

const CODE_TTL_SECONDS = 15 * 60;

function codeHash(env: Env, accountId: string, code: string): Promise<string> {
  return keyedHash(env.EMAIL_PROBE_SECRET, `recovery-email-code:${accountId}:${code}`);
}

export async function issueRecoveryEmailCode(
  env: Env,
  accountId: string,
  timestamp: number,
): Promise<{ code: string } | "cooldown"> {
  const previous = await env.DB.prepare(
    "SELECT sent_at FROM recovery_email_codes WHERE account_id = ?",
  )
    .bind(accountId)
    .first<{ sent_at: number }>();
  if (previous && timestamp - previous.sent_at < CODE_RESEND_COOLDOWN_SECONDS) {
    return "cooldown";
  }

  const code = generateCode();
  await env.DB.prepare(
    `INSERT INTO recovery_email_codes (account_id, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(account_id) DO UPDATE
       SET code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0,
           sent_at = excluded.sent_at`,
  )
    .bind(accountId, await codeHash(env, accountId, code), timestamp + CODE_TTL_SECONDS, timestamp)
    .run();
  return { code };
}

export async function sendRecoveryEmailCode(
  mailer: Mailer,
  request: { email: string; locale: EmailLocale; siteUrl: string },
  code: string,
): Promise<void> {
  await mailer.send({
    to: request.email,
    ...recoveryCodeEmail({ locale: request.locale, siteUrl: request.siteUrl }, code),
  });
}

export async function checkRecoveryEmailCode(
  env: Env,
  accountId: string,
  code: string,
  timestamp: number,
): Promise<"ok" | "invalid" | "expired"> {
  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at, attempts FROM recovery_email_codes WHERE account_id = ?",
  )
    .bind(accountId)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at <= timestamp || row.attempts >= CODE_MAX_ATTEMPTS) {
    return "expired";
  }
  const matches = timingSafeEqual(
    utf8Encode(await codeHash(env, accountId, code)),
    utf8Encode(row.code_hash),
  );
  if (matches) {
    return "ok";
  }
  await env.DB.prepare(
    "UPDATE recovery_email_codes SET attempts = attempts + 1 WHERE account_id = ?",
  )
    .bind(accountId)
    .run();
  return "invalid";
}

export async function clearRecoveryEmailCode(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM recovery_email_codes WHERE account_id = ?")
    .bind(accountId)
    .run();
}
