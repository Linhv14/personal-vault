import { timingSafeEqual, utf8Encode } from "../core/bytes.js";
import { logError } from "./log.js";
import { existingAccountEmail, verificationCodeEmail, type EmailLocale } from "./emails.js";
import { keyedHash } from "./keyed-hash.js";
import { createMailer, type Mailer } from "./mailer.js";
import { CODE_MAX_ATTEMPTS, CODE_RESEND_COOLDOWN_SECONDS, generateCode } from "./one-time-code.js";
import type { Env } from "./types.js";

const CODE_TTL_SECONDS = 15 * 60;

export function emailVerificationEnabled(env: Env): boolean {
  return createMailer(env) !== null;
}

async function codeHash(env: Env, email: string, code: string): Promise<string> {
  return keyedHash(env.EMAIL_PROBE_SECRET, `email-code:${email}:${code}`);
}

export type IssueResult = "sent" | "cooldown" | "failed";

export interface CodeRequest {
  email: string;
  locale: EmailLocale;
  siteUrl: string;
  alreadyRegistered: boolean;
}

export async function issueCode(
  env: Env,
  mailer: Mailer,
  { email, locale, siteUrl, alreadyRegistered }: CodeRequest,
  timestamp: number,
): Promise<IssueResult> {
  const previous = await env.DB.prepare("SELECT sent_at FROM email_verifications WHERE email = ?")
    .bind(email)
    .first<{ sent_at: number }>();
  if (previous && timestamp - previous.sent_at < CODE_RESEND_COOLDOWN_SECONDS) return "cooldown";

  const code = generateCode();
  await env.DB.prepare(
    `INSERT INTO email_verifications (email, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE
       SET code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0,
           sent_at = excluded.sent_at`,
  )
    .bind(email, await codeHash(env, email, code), timestamp + CODE_TTL_SECONDS, timestamp)
    .run();

  const message = alreadyRegistered
    ? existingAccountEmail({ locale, siteUrl })
    : verificationCodeEmail({ locale, siteUrl }, code);
  try {
    await mailer.send({ to: email, ...message });
    return "sent";
  } catch (error) {
    logError("verification_email_failed", error);
    return "failed";
  }
}

export type CheckResult = "ok" | "invalid" | "expired";

export async function consumeCode(
  env: Env,
  email: string,
  code: string,
  timestamp: number,
): Promise<CheckResult> {
  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at, attempts FROM email_verifications WHERE email = ?",
  )
    .bind(email)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at <= timestamp || row.attempts >= CODE_MAX_ATTEMPTS) return "expired";

  const matches = timingSafeEqual(
    utf8Encode(await codeHash(env, email, code)),
    utf8Encode(row.code_hash),
  );
  if (!matches) {
    await env.DB.prepare("UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?")
      .bind(email)
      .run();
    return "invalid";
  }

  await env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(email).run();
  return "ok";
}
