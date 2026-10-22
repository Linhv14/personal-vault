import { fromBase64Url, randomBytes, toBase64, toBase64Url } from "../core/bytes.js";
import { isPlainObject } from "../core/json.js";
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
  if (typeof value !== "object" || value === null) {
    return false;
  }
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
  if (typeof value !== "object" || value === null) {
    return false;
  }
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

const MAX_OPEN_CHALLENGES = 5;
const CHALLENGE_WRITE_ATTEMPTS = 3;

interface OpenChallenge {
  value: string;
  expires: number;
}

function isOpenChallenge(value: unknown): value is OpenChallenge {
  return (
    isPlainObject(value) && typeof value.value === "string" && typeof value.expires === "number"
  );
}

function openChallenges(stored: string | null, now: number): OpenChallenge[] {
  if (!stored) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [];
    return entries.filter(
      (entry): entry is OpenChallenge => isOpenChallenge(entry) && entry.expires >= now,
    );
  } catch {
    return [];
  }
}

async function replaceChallenges(
  env: Env,
  tokenHash: string,
  previous: string | null,
  next: OpenChallenge[],
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE sessions SET bio_challenge = ?
      WHERE token_hash = ? AND bio_key IS NOT NULL AND bio_challenge IS ?`,
  )
    .bind(next.length > 0 ? JSON.stringify(next) : null, tokenHash, previous)
    .run();
  return result.meta.changes === 1;
}

export async function issueBiometricChallenge(
  env: Env,
  tokenHash: string,
  now: number,
): Promise<{ challenge: string; credentialId: string } | null> {
  const challenge = toBase64Url(randomBytes(32));
  for (let attempt = 0; attempt < CHALLENGE_WRITE_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare(
      "SELECT bio_credential, bio_challenge FROM sessions WHERE token_hash = ? AND bio_key IS NOT NULL",
    )
      .bind(tokenHash)
      .first<{ bio_credential: string; bio_challenge: string | null }>();
    if (!row) {
      return null;
    }
    const next = [
      ...openChallenges(row.bio_challenge, now),
      { value: challenge, expires: now + BIOMETRIC_CHALLENGE_SECONDS },
    ].slice(-MAX_OPEN_CHALLENGES);
    if (await replaceChallenges(env, tokenHash, row.bio_challenge, next)) {
      return { challenge, credentialId: row.bio_credential };
    }
  }
  return null;
}

function claimedChallenge(assertion: AssertionInput): string | null {
  try {
    const clientData: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(assertion.clientDataJSON)),
    );
    return isPlainObject(clientData) && typeof clientData.challenge === "string"
      ? clientData.challenge
      : null;
  } catch {
    return null;
  }
}

interface BiometricRow {
  bio_public_key: string;
  bio_algorithm: number;
  bio_rp_id: string;
  bio_origin: string;
  bio_key: string;
  bio_challenge: string | null;
}

async function consumeChallenge(
  env: Env,
  tokenHash: string,
  claimed: string,
  now: number,
): Promise<BiometricRow | null> {
  for (let attempt = 0; attempt < CHALLENGE_WRITE_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare(
      `SELECT bio_public_key, bio_algorithm, bio_rp_id, bio_origin, bio_key, bio_challenge
         FROM sessions WHERE token_hash = ? AND bio_key IS NOT NULL`,
    )
      .bind(tokenHash)
      .first<BiometricRow>();
    if (!row) {
      return null;
    }
    const open = openChallenges(row.bio_challenge, now);
    if (!open.some((entry) => entry.value === claimed)) {
      return null;
    }
    const remaining = open.filter((entry) => entry.value !== claimed);
    if (await replaceChallenges(env, tokenHash, row.bio_challenge, remaining)) {
      return row;
    }
  }
  return null;
}

export async function checkBiometric(
  env: Env,
  tokenHash: string,
  assertion: AssertionInput,
  now: number,
): Promise<string | null> {
  const claimed = claimedChallenge(assertion);
  if (!claimed) {
    return null;
  }
  const row = await consumeChallenge(env, tokenHash, claimed, now);
  if (!row) {
    return null;
  }
  const valid = await verifyAssertion(
    {
      publicKey: row.bio_public_key,
      algorithm: row.bio_algorithm,
      rpId: row.bio_rp_id,
      origin: row.bio_origin,
      challenge: claimed,
    },
    assertion,
  );
  return valid ? row.bio_key : null;
}
