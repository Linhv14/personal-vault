import {
  BACKUP_CODE_COUNT,
  generateBackupCode,
  parseSecondFactor,
} from "../core/account-two-factor.js";
import { APP_NAME } from "../core/brand.js";
import { randomBytes, timingSafeEqual, toBase64Url, utf8Encode } from "../core/bytes.js";
import { buildOtpauthUri, generateTotp, generateTotpSecret, TOTP_DEFAULTS } from "../core/totp.js";
import { protectBackupCode, protectTwoFactorSecret, revealTwoFactorSecret } from "./at-rest.js";
import { hashToken } from "./session.js";
import type { Env } from "./types.js";

export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SETUP_TTL_SECONDS = 15 * 60;
const CHALLENGE_MAX_ATTEMPTS = 5;
const DRIFT_STEPS = 1;

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: number | null;
  backupCodesLeft: number;
}

export async function twoFactorStatus(env: Env, accountId: string): Promise<TwoFactorStatus> {
  const [account, codes] = await env.DB.batch<{ enabled_at?: number | null; remaining?: number }>([
    env.DB.prepare("SELECT totp_enabled_at AS enabled_at FROM accounts WHERE id = ?").bind(
      accountId,
    ),
    env.DB.prepare(
      "SELECT COUNT(*) AS remaining FROM two_factor_backup_codes WHERE account_id = ? AND used_at IS NULL",
    ).bind(accountId),
  ]);
  const enabledAt = account?.results[0]?.enabled_at ?? null;
  return {
    enabled: enabledAt !== null,
    enabledAt,
    backupCodesLeft: enabledAt === null ? 0 : (codes?.results[0]?.remaining ?? 0),
  };
}

export async function startSetup(
  env: Env,
  accountId: string,
  email: string,
  now: number,
): Promise<{ secret: string; uri: string }> {
  const secret = generateTotpSecret();
  await env.DB.prepare(
    "UPDATE accounts SET totp_pending_secret = ?, totp_pending_at = ? WHERE id = ?",
  )
    .bind(await protectTwoFactorSecret(env, accountId, secret), now, accountId)
    .run();
  const uri = buildOtpauthUri({ ...TOTP_DEFAULTS, secret, issuer: APP_NAME, account: email });
  return { secret, uri };
}

function currentStep(now: number): number {
  return Math.floor(now / TOTP_DEFAULTS.period);
}

async function matchingStep(
  secret: string,
  code: string,
  now: number,
  lastStep: number | null,
): Promise<number | null> {
  const current = currentStep(now);
  let matched: number | null = null;
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    const expected = await generateTotp({ secret }, step * TOTP_DEFAULTS.period * 1000);
    const same = timingSafeEqual(utf8Encode(expected), utf8Encode(code));
    if (same && (lastStep === null || step > lastStep) && matched === null) matched = step;
  }
  return matched;
}

function backupCodeStatements(env: Env, accountId: string, hashes: string[], now: number) {
  return [
    env.DB.prepare("DELETE FROM two_factor_backup_codes WHERE account_id = ?").bind(accountId),
    ...hashes.map((hash) =>
      env.DB.prepare(
        "INSERT INTO two_factor_backup_codes (account_id, code_hash, created_at) VALUES (?, ?, ?)",
      ).bind(accountId, hash, now),
    ),
  ];
}

async function freshBackupCodes(
  env: Env,
  accountId: string,
): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) codes.add(generateBackupCode());
  const list = [...codes];
  const hashes = await Promise.all(
    list.map((code) => protectBackupCode(env, accountId, parseSecondFactor(code)!.code)),
  );
  return { codes: list, hashes };
}

export type EnableResult =
  | { ok: true; backupCodes: string[]; enabledAt: number }
  | { ok: false; reason: "expired" | "invalid" | "enabled" };

export async function confirmSetup(
  env: Env,
  accountId: string,
  code: unknown,
  now: number,
): Promise<EnableResult> {
  const row = await env.DB.prepare(
    "SELECT totp_pending_secret, totp_pending_at, totp_enabled_at FROM accounts WHERE id = ?",
  )
    .bind(accountId)
    .first<{
      totp_pending_secret: string | null;
      totp_pending_at: number | null;
      totp_enabled_at: number | null;
    }>();
  if (row?.totp_enabled_at) return { ok: false, reason: "enabled" };
  if (!row?.totp_pending_secret || !row.totp_pending_at) return { ok: false, reason: "expired" };
  if (now - row.totp_pending_at > SETUP_TTL_SECONDS) return { ok: false, reason: "expired" };
  const factor = parseSecondFactor(code);
  if (factor?.kind !== "totp") return { ok: false, reason: "invalid" };
  const secret = await revealTwoFactorSecret(env, accountId, row.totp_pending_secret);
  const step = await matchingStep(secret, factor.code, now, null);
  if (step === null) return { ok: false, reason: "invalid" };

  const updated = await env.DB.prepare(
    `UPDATE accounts
        SET totp_secret = ?, totp_enabled_at = ?, totp_last_step = ?,
            totp_pending_secret = NULL, totp_pending_at = NULL
      WHERE id = ? AND totp_enabled_at IS NULL AND totp_pending_secret = ?`,
  )
    .bind(
      await protectTwoFactorSecret(env, accountId, secret),
      now,
      step,
      accountId,
      row.totp_pending_secret,
    )
    .run();
  if (!updated.meta.changes) return { ok: false, reason: "enabled" };
  const codes = await regenerateBackupCodes(env, accountId, now);
  return { ok: true, backupCodes: codes, enabledAt: now };
}

export async function verifySecondFactor(
  env: Env,
  accountId: string,
  code: unknown,
  now: number,
): Promise<"totp" | "backup" | null> {
  const factor = parseSecondFactor(code);
  const row = await env.DB.prepare(
    "SELECT totp_secret, totp_last_step FROM accounts WHERE id = ? AND totp_enabled_at IS NOT NULL",
  )
    .bind(accountId)
    .first<{ totp_secret: string | null; totp_last_step: number | null }>();
  if (!row?.totp_secret || !factor) return null;

  if (factor.kind === "totp") {
    const secret = await revealTwoFactorSecret(env, accountId, row.totp_secret);
    const step = await matchingStep(secret, factor.code, now, row.totp_last_step);
    if (step === null) return null;
    const claimed = await env.DB.prepare(
      `UPDATE accounts SET totp_last_step = ?
        WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
    )
      .bind(step, accountId, step)
      .run();
    return claimed.meta.changes ? "totp" : null;
  }

  const used = await env.DB.prepare(
    `UPDATE two_factor_backup_codes SET used_at = ?
      WHERE account_id = ? AND code_hash = ? AND used_at IS NULL`,
  )
    .bind(now, accountId, await protectBackupCode(env, accountId, factor.code))
    .run();
  return used.meta.changes ? "backup" : null;
}

export async function regenerateBackupCodes(
  env: Env,
  accountId: string,
  now: number,
): Promise<string[]> {
  const { codes, hashes } = await freshBackupCodes(env, accountId);
  await env.DB.batch(backupCodeStatements(env, accountId, hashes, now));
  return codes;
}

export function disableStatements(env: Env, accountId: string) {
  return [
    env.DB.prepare(
      `UPDATE accounts
          SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
              totp_pending_secret = NULL, totp_pending_at = NULL
        WHERE id = ?`,
    ).bind(accountId),
    env.DB.prepare("DELETE FROM two_factor_backup_codes WHERE account_id = ?").bind(accountId),
    env.DB.prepare("DELETE FROM two_factor_challenges WHERE account_id = ?").bind(accountId),
  ];
}

export async function issueChallenge(
  env: Env,
  accountId: string,
  now: number,
  locale: string,
): Promise<{ challenge: string; expiresAt: number }> {
  const challenge = toBase64Url(randomBytes(32));
  const expiresAt = now + CHALLENGE_TTL_SECONDS;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM two_factor_challenges WHERE account_id = ? AND expires_at <= ?",
    ).bind(accountId, now),
    env.DB.prepare(
      `INSERT INTO two_factor_challenges (token_hash, account_id, expires_at, locale)
       VALUES (?, ?, ?, ?)`,
    ).bind(await hashToken(challenge), accountId, expiresAt, locale),
  ]);
  return { challenge, expiresAt };
}

export interface Challenge {
  tokenHash: string;
  accountId: string;
  attempts: number;
  locale: string | null;
}

export async function findChallenge(
  env: Env,
  challenge: string,
  now: number,
): Promise<Challenge | null> {
  const tokenHash = await hashToken(challenge);
  const row = await env.DB.prepare(
    `SELECT account_id, attempts, locale FROM two_factor_challenges
      WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<{ account_id: string; attempts: number; locale: string | null }>();
  return row
    ? { tokenHash, accountId: row.account_id, attempts: row.attempts, locale: row.locale }
    : null;
}

export async function noteChallengeFailure(env: Env, challenge: Challenge): Promise<void> {
  if (challenge.attempts + 1 >= CHALLENGE_MAX_ATTEMPTS) {
    await consumeChallenge(env, challenge);
    return;
  }
  await env.DB.prepare(
    "UPDATE two_factor_challenges SET attempts = attempts + 1 WHERE token_hash = ?",
  )
    .bind(challenge.tokenHash)
    .run();
}

export async function consumeChallenge(env: Env, challenge: Challenge): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM two_factor_challenges WHERE token_hash = ?")
    .bind(challenge.tokenHash)
    .run();
  return result.meta.changes > 0;
}
