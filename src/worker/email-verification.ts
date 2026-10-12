import { toBase64, timingSafeEqual, utf8Encode } from "../core/bytes.js";
import { APP_NAME } from "../core/brand.js";
import { randomInt } from "../core/generator.js";
import { createMailer, type Mailer } from "./mailer.js";
import type { Env } from "./types.js";

const CODE_TTL_SECONDS = 15 * 60;
export const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

export function emailVerificationEnabled(env: Env): boolean {
  return createMailer(env) !== null;
}

export function isCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

async function codeHash(env: Env, email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(env.EMAIL_PROBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, utf8Encode(`email-code:${email}:${code}`));
  return toBase64(new Uint8Array(mac));
}

type Locale = "en" | "vi";

const COPY = {
  en: {
    codeSubject: (code: string) => `${code} is your ${APP_NAME} code`,
    codeBody: (code: string) =>
      `Your ${APP_NAME} verification code is ${code}.\n\nIt expires in 15 minutes. If you did not try to create a vault, you can ignore this email.`,
    existingSubject: "Someone tried to sign up with your email",
    existingBody: `Someone, possibly you, just tried to create a ${APP_NAME} account with this email address, but it already has one.\n\nIf it was you, choose "Sign in to your vault" instead. If not, you can ignore this email: your vault is unaffected.`,
  },
  vi: {
    codeSubject: (code: string) => `${code} là mã ${APP_NAME} của bạn`,
    codeBody: (code: string) =>
      `Mã xác minh ${APP_NAME} của bạn là ${code}.\n\nMã hết hạn sau 15 phút. Nếu bạn không tạo vault, hãy bỏ qua thư này.`,
    existingSubject: "Có người thử đăng ký bằng email của bạn",
    existingBody: `Ai đó, có thể là bạn, vừa thử tạo tài khoản ${APP_NAME} bằng địa chỉ email này, nhưng email đã có tài khoản.\n\nNếu là bạn, hãy chọn "Đăng nhập vault có sẵn". Nếu không, bạn có thể bỏ qua thư này: vault của bạn không bị ảnh hưởng.`,
  },
} as const;

function html(text: string, code?: string): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const paragraphs = text
    .split("\n\n")
    .map((paragraph) => `<p style="margin:0 0 16px">${escape(paragraph)}</p>`)
    .join("");
  const codeBlock = code
    ? `<p style="margin:0 0 20px;font:600 30px/1 ui-monospace,Menlo,monospace;letter-spacing:6px">${code}</p>`
    : "";
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#15181d;max-width:480px">${codeBlock}${paragraphs}</div>`;
}

export type IssueResult = "sent" | "cooldown" | "failed";

export async function issueCode(
  env: Env,
  mailer: Mailer,
  email: string,
  locale: Locale,
  alreadyRegistered: boolean,
  timestamp: number,
): Promise<IssueResult> {
  const previous = await env.DB.prepare("SELECT sent_at FROM email_verifications WHERE email = ?")
    .bind(email)
    .first<{ sent_at: number }>();
  if (previous && timestamp - previous.sent_at < RESEND_COOLDOWN_SECONDS) return "cooldown";

  const code = String(randomInt(1_000_000)).padStart(6, "0");
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

  const copy = COPY[locale];
  const subject = alreadyRegistered ? copy.existingSubject : copy.codeSubject(code);
  const text = alreadyRegistered ? copy.existingBody : copy.codeBody(code);
  try {
    await mailer.send({
      to: email,
      subject,
      text,
      html: html(text, alreadyRegistered ? undefined : code),
    });
    return "sent";
  } catch (error) {
    console.error("Verification email failed:", error);
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
  if (!row || row.expires_at <= timestamp || row.attempts >= MAX_ATTEMPTS) return "expired";

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
