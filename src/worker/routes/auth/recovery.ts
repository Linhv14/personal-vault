import { Hono } from "hono";
import { toBase64 } from "#core/bytes.js";
import { isPlainObject } from "#core/json.js";
import {
  protectAuthKey,
  protectWrappedKey,
  recoveryScope,
  revealWrappedKey,
  verifyAuthKey,
} from "#worker/at-rest.js";
import { normalizeEmail } from "#worker/email-address.js";
import { accountRecoveredEmail, twoFactorDisabledEmail } from "#worker/emails.js";
import { apiError } from "#worker/errors.js";
import { now } from "#worker/clock.js";
import { inBackground, readJson } from "#worker/http.js";
import { createMailer } from "#worker/mailer.js";
import { CODE_RESEND_COOLDOWN_SECONDS } from "#worker/one-time-code.js";
import {
  clearRecoveryEmailCode,
  issueRecoveryEmailCode,
  recoveryEmailCodeError,
  sendRecoveryEmailCode,
} from "#worker/recovery-email.js";
import { clientIp } from "#worker/request.js";
import { revokeAllSessions } from "#worker/session.js";
import { throttle } from "#worker/throttle.js";
import { disableStatements } from "#worker/two-factor.js";
import type { AppBindings, Env } from "#worker/types.js";
import { isBase64, isKdf, isSealed } from "#worker/validate.js";

const routes = new Hono<AppBindings>();

interface RecoveryRow {
  id: string;
  totp_enabled_at: number | null;
  recovery_auth_hash: string | null;
  recovery_wrapped_key: string | null;
  recovery_nonce: string | null;
}

async function checkRecovery(
  env: Env,
  email: string,
  ip: string,
  recoveryAuthKey: string,
  timestamp: number,
): Promise<RecoveryRow | { retryAfter: number } | null> {
  const guard = await throttle(env, "recovery", email, ip, timestamp);
  if (guard.retryAfter) {
    return { retryAfter: guard.retryAfter };
  }
  await guard.slowDown();
  const row = await env.DB.prepare(
    `SELECT id, recovery_auth_hash, recovery_wrapped_key, recovery_nonce, totp_enabled_at
       FROM accounts WHERE email = ?`,
  )
    .bind(email)
    .first<RecoveryRow>();
  const stored = row?.recovery_auth_hash ?? "v2:" + toBase64(new Uint8Array(32));
  const { matches } = await verifyAuthKey(env, recoveryAuthKey, stored);
  if (!row?.recovery_auth_hash || !matches) {
    await guard.fail();
    return null;
  }
  await guard.clear();
  return row;
}

routes.post("/recover/email", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!email || !isBase64(body.recoveryAuthKey, 32)) {
    return c.json(apiError("auth.invalid_recovery_code"), 400);
  }
  const timestamp = now();
  const row = await checkRecovery(c.env, email, clientIp(c), body.recoveryAuthKey, timestamp);
  if (row && "retryAfter" in row) {
    return c.json(apiError("auth.rate_limited", { seconds: row.retryAfter }), 429);
  }
  if (!row) {
    return c.json(apiError("auth.invalid_recovery_code"), 401);
  }
  const mailer = createMailer(c.env);
  if (!mailer) {
    return c.json({ required: false });
  }
  const issued = await issueRecoveryEmailCode(c.env, row.id, timestamp);
  if (issued === "cooldown") {
    return c.json(apiError("auth.code_cooldown", { seconds: CODE_RESEND_COOLDOWN_SECONDS }), 429);
  }
  const request = {
    email,
    locale: body.locale === "vi" ? ("vi" as const) : ("en" as const),
    siteUrl: new URL(c.req.url).origin,
  };
  inBackground(c, "recovery_code_email_failed", () =>
    sendRecoveryEmailCode(mailer, request, issued.code),
  );
  return c.json({ required: true });
});

routes.post("/recover/start", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!email || !isBase64(body.recoveryAuthKey, 32)) {
    return c.json(apiError("auth.invalid_recovery_code"), 400);
  }
  const timestamp = now();
  const row = await checkRecovery(c.env, email, clientIp(c), body.recoveryAuthKey, timestamp);
  if (row && "retryAfter" in row) {
    return c.json(apiError("auth.rate_limited", { seconds: row.retryAfter }), 429);
  }
  if (!row) {
    return c.json(apiError("auth.invalid_recovery_code"), 401);
  }
  const codeError = await recoveryEmailCodeError(c.env, row.id, body.emailCode, timestamp);
  if (codeError) {
    return c.json(apiError(codeError), 400);
  }
  const wrapped = await revealWrappedKey(c.env, recoveryScope(row.id), row.recovery_wrapped_key!);
  c.header("Cache-Control", "no-store");
  return c.json({ wrappedVaultKey: { ciphertext: wrapped.ciphertext, nonce: row.recovery_nonce } });
});

routes.post("/recover/finish", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  const { recoveryAuthKey, kdf, authKey, wrappedVaultKey, recovery } = body;
  const next = isPlainObject(recovery) ? recovery : {};
  if (!email || !isBase64(recoveryAuthKey, 32)) {
    return c.json(apiError("auth.invalid_recovery_code"), 400);
  }
  if (!isKdf(kdf)) {
    return c.json(apiError("auth.invalid_kdf"), 400);
  }
  if (!isBase64(authKey, 32) || !isBase64(next.authKey, 32)) {
    return c.json(apiError("auth.invalid_auth_key"), 400);
  }
  if (!isSealed(wrappedVaultKey, 64) || !isSealed(next.wrappedVaultKey, 64)) {
    return c.json(apiError("auth.invalid_wrapped_key"), 400);
  }

  const timestamp = now();
  const row = await checkRecovery(c.env, email, clientIp(c), recoveryAuthKey, timestamp);
  if (row && "retryAfter" in row) {
    return c.json(apiError("auth.rate_limited", { seconds: row.retryAfter }), 429);
  }
  if (!row) {
    return c.json(apiError("auth.invalid_recovery_code"), 401);
  }
  const codeError = await recoveryEmailCodeError(c.env, row.id, body.emailCode, timestamp);
  if (codeError) {
    return c.json(apiError(codeError), 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE accounts
        SET kdf_type = ?, kdf_iterations = ?, kdf_salt = ?,
            auth_key_hash = ?, wrapped_vault_key = ?, wrap_nonce = ?,
            recovery_auth_hash = ?, recovery_wrapped_key = ?, recovery_nonce = ?,
            recovery_created_at = ?
      WHERE id = ? AND recovery_auth_hash = ?`,
  )
    .bind(
      kdf.type,
      kdf.iterations,
      kdf.salt,
      await protectAuthKey(c.env, authKey),
      await protectWrappedKey(c.env, row.id, wrappedVaultKey.ciphertext),
      wrappedVaultKey.nonce,
      await protectAuthKey(c.env, next.authKey),
      await protectWrappedKey(c.env, recoveryScope(row.id), next.wrappedVaultKey.ciphertext),
      next.wrappedVaultKey.nonce,
      timestamp,
      row.id,
      row.recovery_auth_hash,
    )
    .run();
  if (!result.meta.changes) {
    return c.json(apiError("auth.invalid_recovery_code"), 401);
  }

  const twoFactorDisabled = row.totp_enabled_at !== null;
  if (twoFactorDisabled) {
    await c.env.DB.batch(disableStatements(c.env, row.id));
  }
  await revokeAllSessions(c.env, row.id);
  await (await throttle(c.env, "login", email, clientIp(c), timestamp)).clear();
  await clearRecoveryEmailCode(c.env, row.id);
  const mailer = createMailer(c.env);
  if (mailer) {
    const context = {
      locale: body.locale === "vi" ? ("vi" as const) : ("en" as const),
      siteUrl: new URL(c.req.url).origin,
    };
    const message = accountRecoveredEmail(context);
    inBackground(c, "recovery_email_failed", () => mailer.send({ to: email, ...message }));
    if (twoFactorDisabled) {
      const notice = twoFactorDisabledEmail(context, { byRecovery: true });
      inBackground(c, "two_factor_email_failed", () => mailer.send({ to: email, ...notice }));
    }
  }
  return c.json({ ok: true, ...(twoFactorDisabled ? { twoFactorDisabled: true } : {}) });
});

export default routes;
