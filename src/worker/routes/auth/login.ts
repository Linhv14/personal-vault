import { Hono } from "hono";
import { DEFAULT_KDF_ITERATIONS } from "../../../core/crypto.js";
import { toBase64 } from "../../../core/bytes.js";
import {
  protectAuthKey,
  protectWrappedKey,
  revealWrappedKey,
  verifyAuthKey,
} from "../../at-rest.js";
import { normalizeEmail } from "../../email-address.js";
import { apiError } from "../../errors.js";
import { now, readJson } from "../../http.js";
import { keyedHashBytes } from "../../keyed-hash.js";
import { clientIp, requestLocale } from "../../request.js";
import { signedIn } from "../../sign-in.js";
import { throttle } from "../../throttle.js";
import {
  consumeChallenge,
  findChallenge,
  issueChallenge,
  noteChallengeFailure,
  verifySecondFactor,
} from "../../two-factor.js";
import type { AppBindings, Env } from "../../types.js";
import { isBase64, type KdfBody } from "../../validate.js";

const routes = new Hono<AppBindings>();

routes.post("/prelogin", async (c) => {
  const email = normalizeEmail((await readJson(c)).email);
  if (!email) {
    return c.json(apiError("auth.invalid_email"), 400);
  }

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
  const mac = await keyedHashBytes(env.EMAIL_PROBE_SECRET, email);
  return {
    type: "pbkdf2-sha256",
    iterations: DEFAULT_KDF_ITERATIONS,
    salt: toBase64(mac.slice(0, 16)),
  };
}

routes.post("/login", async (c) => {
  const body = await readJson(c);
  const { email: rawEmail, authKey } = body;
  const email = normalizeEmail(rawEmail);
  if (!email || !isBase64(authKey, 32)) {
    return c.json(apiError("auth.invalid_credentials"), 400);
  }

  const timestamp = now();
  const guard = await throttle(c.env, "login", email, clientIp(c), timestamp);
  if (guard.retryAfter) {
    return c.json(apiError("auth.rate_limited", { seconds: guard.retryAfter }), 429);
  }
  await guard.slowDown();

  const row = await c.env.DB.prepare(
    "SELECT id, auth_key_hash, wrapped_vault_key, totp_enabled_at FROM accounts WHERE email = ?",
  )
    .bind(email)
    .first<{
      id: string;
      auth_key_hash: string;
      wrapped_vault_key: string;
      totp_enabled_at: number | null;
    }>();

  const verification = row
    ? await verifyAuthKey(c.env, authKey, row.auth_key_hash, { acceptLegacy: true })
    : await verifyAuthKey(c.env, authKey, "v2:" + toBase64(new Uint8Array(32)));

  if (!row || !verification.matches) {
    await guard.fail();
    return c.json(apiError("auth.invalid_credentials"), 401);
  }

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
  const locale = requestLocale(c, body.locale);
  if (row.totp_enabled_at !== null) {
    c.header("Cache-Control", "no-store");
    return c.json({
      twoFactor: "required",
      ...(await issueChallenge(c.env, row.id, timestamp, locale)),
    });
  }
  await guard.clear();
  return c.json(await signedIn(c, row.id, email, locale, timestamp));
});

routes.post("/login/2fa", async (c) => {
  const body = await readJson(c);
  const { challenge: token, code } = body;
  if (typeof token !== "string" || token.length > 128) {
    return c.json(apiError("auth.two_factor_expired"), 401);
  }
  const timestamp = now();
  const challenge = await findChallenge(c.env, token, timestamp);
  if (!challenge) {
    return c.json(apiError("auth.two_factor_expired"), 401);
  }
  const account = await c.env.DB.prepare("SELECT email FROM accounts WHERE id = ?")
    .bind(challenge.accountId)
    .first<{ email: string }>();
  if (!account) {
    return c.json(apiError("auth.two_factor_expired"), 401);
  }

  const guard = await throttle(c.env, "login", account.email, clientIp(c), timestamp);
  if (guard.retryAfter) {
    return c.json(apiError("auth.rate_limited", { seconds: guard.retryAfter }), 429);
  }
  await guard.slowDown();

  const factor = await verifySecondFactor(c.env, challenge.accountId, code, timestamp);
  if (!factor) {
    await guard.fail();
    await noteChallengeFailure(c.env, challenge);
    return c.json(apiError("auth.invalid_2fa"), 401);
  }
  if (!(await consumeChallenge(c.env, challenge))) {
    return c.json(apiError("auth.two_factor_expired"), 401);
  }
  await guard.clear();
  const locale = challenge.locale === "vi" ? "vi" : "en";
  return c.json(await signedIn(c, challenge.accountId, account.email, locale, timestamp));
});

export default routes;
