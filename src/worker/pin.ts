import { fromBase64, randomBytes, timingSafeEqual, toBase64 } from "../core/bytes.js";
import { keyedHash } from "./keyed-hash.js";
import type { Env } from "./types.js";
import { isBase64 } from "./validate.js";

export const PIN_MAX_ATTEMPTS = 5;

export async function setPin(env: Env, tokenHash: string, verifierHash: string): Promise<string> {
  const pinKey = toBase64(randomBytes(32));
  await env.DB.prepare(
    "UPDATE sessions SET pin_verifier = ?, pin_key = ?, pin_attempts = 0 WHERE token_hash = ?",
  )
    .bind(verifierHash, pinKey, tokenHash)
    .run();
  return pinKey;
}

export async function clearPin(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE sessions SET pin_verifier = NULL, pin_key = NULL, pin_attempts = 0 WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .run();
}

export type PinCheck = { ok: true; pinKey: string } | { ok: false; attemptsLeft: number };

export async function checkPin(
  env: Env,
  tokenHash: string,
  verifierHash: string,
): Promise<PinCheck> {
  const row = await env.DB.prepare(
    `UPDATE sessions SET pin_attempts = pin_attempts + 1
      WHERE token_hash = ? AND pin_key IS NOT NULL AND pin_attempts < ?
      RETURNING pin_verifier, pin_key, pin_attempts`,
  )
    .bind(tokenHash, PIN_MAX_ATTEMPTS)
    .first<{ pin_verifier: string; pin_key: string; pin_attempts: number }>();
  if (!row) {
    await clearPin(env, tokenHash);
    return { ok: false, attemptsLeft: 0 };
  }
  if (timingSafeEqual(fromBase64(row.pin_verifier), fromBase64(verifierHash))) {
    await env.DB.prepare("UPDATE sessions SET pin_attempts = 0 WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
    return { ok: true, pinKey: row.pin_key };
  }
  const attemptsLeft = PIN_MAX_ATTEMPTS - row.pin_attempts;
  if (attemptsLeft <= 0) await clearPin(env, tokenHash);
  return { ok: false, attemptsLeft };
}

export function isVerifier(value: unknown): value is string {
  return isBase64(value, 32) && fromBase64(value).length === 32;
}

export function verifierHash(env: Env, verifier: string): Promise<string> {
  return keyedHash(env.EMAIL_PROBE_SECRET, `pin-verifier:${verifier}`);
}
