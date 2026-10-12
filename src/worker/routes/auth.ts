import { Hono } from "hono";
import { DEFAULT_KDF_ITERATIONS } from "../../core/crypto.js";
import { timingSafeEqual, toBase64, utf8Encode } from "../../core/bytes.js";
import { protectAuthKey, protectWrappedKey, revealWrappedKey, verifyAuthKey } from "../at-rest.js";
import { apiError } from "../errors.js";
import { clientIp, isOpenRegistration } from "../request.js";
import { createSession, isBase64, revokeAllSessions, revokeSession } from "../session.js";
import type { AppBindings, Env } from "../types.js";

const auth = new Hono<AppBindings>();

const MAX_ACCOUNTS_PER_IP_PER_DAY = 5;
const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Only a sanity check: here an email is an account identifier and the KDF
  // salt, not an address anything is delivered to.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

interface SealedBody {
  ciphertext: string;
  nonce: string;
}

function isSealed(value: unknown, maxBytes = 4096): value is SealedBody {
  if (typeof value !== "object" || value === null) return false;
  const { ciphertext, nonce } = value as Record<string, unknown>;
  // An AES-GCM nonce is always exactly 12 bytes; anything else means a broken
  // client or someone probing.
  return isBase64(ciphertext, maxBytes) && isBase64(nonce, 12);
}

interface KdfBody {
  type: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

function isKdf(value: unknown): value is KdfBody {
  if (typeof value !== "object" || value === null) return false;
  const { type, iterations, salt } = value as Record<string, unknown>;
  return (
    type === "pbkdf2-sha256" &&
    typeof iterations === "number" &&
    // Lower bound so a client cannot downgrade itself into brute-force range;
    // upper bound so nobody locks themselves out with a number that hangs the
    // browser.
    iterations >= 100_000 &&
    iterations <= 5_000_000 &&
    isBase64(salt, 64)
  );
}

/**
 * Registration requires a secret token.
 *
 * Without this step, a Worker that is reachable on the internet is an open
 * signup page for anyone who finds the URL. They could not read your vault, but
 * they would consume your quota and turn your infrastructure into a host for
 * strangers' data.
 */
auth.post("/register", async (c) => {
  const openRegistration = isOpenRegistration(c.env);
  if (!openRegistration) {
    const provided = c.req.header("x-registration-token") ?? "";
    const expected = c.env.REGISTRATION_TOKEN;
    if (!expected || !timingSafeEqual(utf8Encode(provided), utf8Encode(expected))) {
      return c.json(apiError("auth.bad_registration_token"), 403);
    }
  }

  const body = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json(apiError("auth.invalid_body"), 400);
  }

  const { email: rawEmail, kdf, authKey, wrappedVaultKey } = body as Record<string, unknown>;
  const email = normalizeEmail(rawEmail);
  if (!email) return c.json(apiError("auth.invalid_email"), 400);
  if (!isKdf(kdf)) return c.json(apiError("auth.invalid_kdf"), 400);
  if (!isBase64(authKey, 32)) return c.json(apiError("auth.invalid_auth_key"), 400);
  if (!isSealed(wrappedVaultKey, 64)) {
    return c.json(apiError("auth.invalid_wrapped_key"), 400);
  }

  const timestamp = now();
  if (openRegistration && !(await claimRegistrationSlot(c.env, clientIp(c), timestamp))) {
    return c.json(apiError("auth.registration_limit"), 429);
  }
  const accountId = crypto.randomUUID();

  try {
    await c.env.DB.prepare(
      `INSERT INTO accounts
         (id, email, kdf_type, kdf_iterations, kdf_salt,
          auth_key_hash, wrapped_vault_key, wrap_nonce, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        accountId,
        email,
        kdf.type,
        kdf.iterations,
        kdf.salt,
        await protectAuthKey(c.env, authKey),
        await protectWrappedKey(c.env, accountId, wrappedVaultKey.ciphertext),
        wrappedVaultKey.nonce,
        timestamp,
      )
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return c.json(apiError("auth.email_taken"), 409);
    }
    throw error;
  }

  const session = await createSession(c.env, accountId, timestamp);
  return c.json({ accountId, ...session }, 201);
});

/**
 * Hand back the KDF params so the client can derive its auth key *before*
 * signing in.
 *
 * An address that does not exist still receives plausible params, derived
 * deterministically from an HMAC of a server-side secret. Returning 404 here
 * would let anyone enumerate which addresses are registered — and for a personal
 * vault that address is half of the target.
 */
auth.post("/prelogin", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail((body as Record<string, unknown> | null)?.email);
  if (!email) return c.json(apiError("auth.invalid_email"), 400);

  const row = await c.env.DB.prepare(
    "SELECT kdf_type, kdf_iterations, kdf_salt FROM accounts WHERE email = ?",
  )
    .bind(email)
    .first<{ kdf_type: string; kdf_iterations: number; kdf_salt: string }>();

  if (row) {
    return c.json({
      kdf: { type: row.kdf_type, iterations: row.kdf_iterations, salt: row.kdf_salt },
    });
  }

  return c.json({ kdf: await decoyKdf(c.env, email) });
});

async function decoyKdf(env: Env, email: string): Promise<KdfBody> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(env.EMAIL_PROBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8Encode(email)));
  return {
    type: "pbkdf2-sha256",
    iterations: DEFAULT_KDF_ITERATIONS,
    salt: toBase64(mac.slice(0, 16)),
  };
}

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { email: rawEmail, authKey } = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(rawEmail);
  if (!email || !isBase64(authKey, 32)) {
    return c.json(apiError("auth.invalid_credentials"), 400);
  }

  const timestamp = now();
  const lock = await checkLock(c.env, email, timestamp);
  if (lock) {
    return c.json(apiError("auth.rate_limited", { seconds: lock }), 429);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, auth_key_hash, wrapped_vault_key, wrap_nonce
       FROM accounts WHERE email = ?`,
  )
    .bind(email)
    .first<{
      id: string;
      auth_key_hash: string;
      wrapped_vault_key: string;
      wrap_nonce: string;
    }>();

  // Compare in constant time, and run the comparison even when no account
  // exists, so response timing does not reveal which addresses are real.
  const verification = row
    ? await verifyAuthKey(c.env, authKey, row.auth_key_hash)
    : await verifyAuthKey(c.env, authKey, "v2:" + toBase64(new Uint8Array(32)));

  if (!row || !verification.matches) {
    await recordFailure(c.env, email, timestamp);
    return c.json(apiError("auth.invalid_credentials"), 401);
  }

  await clearFailures(c.env, email);
  const wrapped = await revealWrappedKey(c.env, row.id, row.wrapped_vault_key);
  if (verification.needsUpgrade || wrapped.needsUpgrade) {
    await c.env.DB.prepare(
      "UPDATE accounts SET auth_key_hash = ?, wrapped_vault_key = ? WHERE id = ? AND auth_key_hash = ?",
    )
      .bind(
        await protectAuthKey(c.env, authKey),
        await protectWrappedKey(c.env, row.id, wrapped.ciphertext),
        row.id,
        row.auth_key_hash,
      )
      .run();
  }
  const session = await createSession(c.env, row.id, timestamp);

  return c.json({
    ...session,
    wrappedVaultKey: { ciphertext: wrapped.ciphertext, nonce: row.wrap_nonce },
  });
});

auth.post("/delete-account", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { currentAuthKey } = (body ?? {}) as Record<string, unknown>;
  if (!isBase64(currentAuthKey, 32)) return c.json(apiError("auth.invalid_credentials"), 400);

  const { accountId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT email, auth_key_hash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ email: string; auth_key_hash: string }>();
  if (!row || !(await verifyAuthKey(c.env, currentAuthKey, row.auth_key_hash)).matches) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM items WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(row.email),
    c.env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId),
  ]);
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  await revokeSession(c.env, c.get("session").tokenHash);
  return c.json({ ok: true });
});

/**
 * Change the master password. The client derives the new keys and re-wraps the
 * vault key itself, so the server only swaps three columns — no item is touched.
 */
auth.post("/change-password", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { currentAuthKey, kdf, authKey, wrappedVaultKey } = (body ?? {}) as Record<string, unknown>;
  if (!isBase64(currentAuthKey, 32)) return c.json(apiError("auth.invalid_credentials"), 400);
  if (!isKdf(kdf)) return c.json(apiError("auth.invalid_kdf"), 400);
  if (!isBase64(authKey, 32)) return c.json(apiError("auth.invalid_auth_key"), 400);
  if (!isSealed(wrappedVaultKey, 64)) return c.json(apiError("auth.invalid_wrapped_key"), 400);

  const { accountId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT auth_key_hash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ auth_key_hash: string }>();
  if (!row || !(await verifyAuthKey(c.env, currentAuthKey, row.auth_key_hash)).matches) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }

  const result = await c.env.DB.prepare(
    `UPDATE accounts
        SET kdf_type = ?, kdf_iterations = ?, kdf_salt = ?,
            auth_key_hash = ?, wrapped_vault_key = ?, wrap_nonce = ?
      WHERE id = ? AND auth_key_hash = ?`,
  )
    .bind(
      kdf.type,
      kdf.iterations,
      kdf.salt,
      await protectAuthKey(c.env, authKey),
      await protectWrappedKey(c.env, accountId, wrappedVaultKey.ciphertext),
      wrappedVaultKey.nonce,
      accountId,
      row.auth_key_hash,
    )
    .run();
  if (!result.meta.changes) return c.json(apiError("auth.invalid_credentials"), 403);

  // Revoke every session: other devices still hold the old vault key and must
  // unlock again.
  await revokeAllSessions(c.env, accountId);
  return c.json({ ok: true });
});

async function claimRegistrationSlot(env: Env, ip: string, timestamp: number): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(env.EMAIL_PROBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const ipHash = toBase64(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8Encode(`registration-ip:${ip}`))),
  );
  const claimed = await env.DB.prepare(
    `INSERT INTO registration_counts (ip_hash, day, count) VALUES (?, ?, 1)
     ON CONFLICT(ip_hash, day) DO UPDATE SET count = count + 1
       WHERE count < ?
     RETURNING count`,
  )
    .bind(ipHash, Math.floor(timestamp / 86_400), MAX_ACCOUNTS_PER_IP_PER_DAY)
    .first<{ count: number }>();
  return claimed !== null;
}

// Online password-guessing defence

async function checkLock(env: Env, email: string, timestamp: number): Promise<number | null> {
  const row = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE email = ?")
    .bind(email)
    .first<{ locked_until: number | null }>();
  const until = row?.locked_until ?? 0;
  return until > timestamp ? until - timestamp : null;
}

async function recordFailure(env: Env, email: string, timestamp: number): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT failures, window_start FROM login_attempts WHERE email = ?",
  )
    .bind(email)
    .first<{ failures: number; window_start: number }>();

  // A plain sliding window: once the window lapses, counting restarts.
  const inWindow = row !== null && timestamp - row.window_start < WINDOW_SECONDS;
  const failures = inWindow ? row.failures + 1 : 1;
  const windowStart = inWindow ? row.window_start : timestamp;
  const lockedUntil = failures >= MAX_FAILURES ? timestamp + LOCK_SECONDS : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (email, failures, window_start, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE
       SET failures = excluded.failures,
           window_start = excluded.window_start,
           locked_until = excluded.locked_until`,
  )
    .bind(email, failures, windowStart, lockedUntil)
    .run();
}

async function clearFailures(env: Env, email: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}

export default auth;
