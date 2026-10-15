import { randomBytes, toBase64, toBase64Url } from "../core/bytes.js";
import type { Env } from "./types.js";
import { isBase64Url } from "./validate.js";
import { ES256, RS256, verifyAssertion, type AssertionInput } from "./webauthn.js";

const BIOMETRIC_CHALLENGE_SECONDS = 120;

export interface BiometricRegistration {
  credentialId: string;
  publicKey: string;
  algorithm: number;
  rpId: string;
  origin: string;
}

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;

export function isRegistration(value: unknown): value is BiometricRegistration {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  const origin = typeof body.origin === "string" ? EXTENSION_ORIGIN.exec(body.origin) : null;
  return (
    isBase64Url(body.credentialId, 1024) &&
    isBase64Url(body.publicKey, 2048) &&
    (body.algorithm === ES256 || body.algorithm === RS256) &&
    origin !== null &&
    body.rpId === origin[1]
  );
}

export function isAssertion(value: unknown): value is AssertionInput {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    isBase64Url(body.clientDataJSON, 4096) &&
    isBase64Url(body.authenticatorData, 1024) &&
    isBase64Url(body.signature, 1024)
  );
}

export async function setBiometric(
  env: Env,
  tokenHash: string,
  registration: BiometricRegistration,
): Promise<string> {
  const bioKey = toBase64(randomBytes(32));
  await env.DB.prepare(
    `UPDATE sessions SET bio_credential = ?, bio_public_key = ?, bio_algorithm = ?, bio_rp_id = ?,
            bio_origin = ?, bio_key = ?, bio_challenge = NULL, bio_challenge_expires = NULL
      WHERE token_hash = ?`,
  )
    .bind(
      registration.credentialId,
      registration.publicKey,
      registration.algorithm,
      registration.rpId,
      registration.origin,
      bioKey,
      tokenHash,
    )
    .run();
  return bioKey;
}

export async function clearBiometric(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE sessions SET bio_credential = NULL, bio_public_key = NULL, bio_algorithm = NULL,
            bio_rp_id = NULL, bio_origin = NULL, bio_key = NULL, bio_challenge = NULL,
            bio_challenge_expires = NULL
      WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .run();
}

export async function issueBiometricChallenge(
  env: Env,
  tokenHash: string,
  now: number,
): Promise<{ challenge: string; credentialId: string } | null> {
  const challenge = toBase64Url(randomBytes(32));
  const row = await env.DB.prepare(
    `UPDATE sessions SET bio_challenge = ?, bio_challenge_expires = ?
      WHERE token_hash = ? AND bio_key IS NOT NULL
      RETURNING bio_credential`,
  )
    .bind(challenge, now + BIOMETRIC_CHALLENGE_SECONDS, tokenHash)
    .first<{ bio_credential: string }>();
  return row ? { challenge, credentialId: row.bio_credential } : null;
}

export async function checkBiometric(
  env: Env,
  tokenHash: string,
  assertion: AssertionInput,
  now: number,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT bio_public_key, bio_algorithm, bio_rp_id, bio_origin, bio_key, bio_challenge,
            bio_challenge_expires
       FROM sessions
      WHERE token_hash = ? AND bio_key IS NOT NULL AND bio_challenge IS NOT NULL`,
  )
    .bind(tokenHash)
    .first<{
      bio_public_key: string;
      bio_algorithm: number;
      bio_rp_id: string;
      bio_origin: string;
      bio_key: string;
      bio_challenge: string;
      bio_challenge_expires: number;
    }>();
  if (!row) return null;
  const spent = await env.DB.prepare(
    `UPDATE sessions SET bio_challenge = NULL, bio_challenge_expires = NULL
      WHERE token_hash = ? AND bio_challenge = ?`,
  )
    .bind(tokenHash, row.bio_challenge)
    .run();
  if (spent.meta.changes !== 1 || row.bio_challenge_expires < now) return null;
  const valid = await verifyAssertion(
    {
      publicKey: row.bio_public_key,
      algorithm: row.bio_algorithm,
      rpId: row.bio_rp_id,
      origin: row.bio_origin,
      challenge: row.bio_challenge,
    },
    assertion,
  );
  return valid ? row.bio_key : null;
}
