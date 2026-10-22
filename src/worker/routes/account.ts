import { Hono } from "hono";
import { isPublicKey } from "../../core/identity.js";
import { protectAuthKey, protectWrappedKey, recoveryScope, verifyAuthKey } from "../at-rest.js";
import { twoFactorDisabledEmail, twoFactorEnabledEmail } from "../emails.js";
import { apiError } from "../errors.js";
import { inBackground, now, readJson } from "../http.js";
import { createMailer } from "../mailer.js";
import { clientIp, requestLocale } from "../request.js";
import { revokeOtherSessions } from "../session.js";
import { throttle } from "../throttle.js";
import {
  confirmSetup,
  disableStatements,
  regenerateBackupCodes,
  startSetup,
  twoFactorStatus,
  verifySecondFactor,
} from "../two-factor.js";
import { isBase64, isSealed } from "../validate.js";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";

const account = new Hono<AppBindings>();

account.get("/identity", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT public_key, wrapped_private_key FROM accounts WHERE id = ?",
  )
    .bind(c.get("session").accountId)
    .first<{ public_key: string | null; wrapped_private_key: string | null }>();
  c.header("Cache-Control", "no-store");
  if (!row?.public_key || !row.wrapped_private_key) {
    return c.json({ identity: null });
  }
  return c.json({
    identity: {
      publicKey: row.public_key,
      wrappedPrivateKey: JSON.parse(row.wrapped_private_key) as unknown,
    },
  });
});

account.put("/identity", async (c) => {
  const body = await readJson(c);
  if (!isPublicKey(body.publicKey) || !isSealed(body.wrappedPrivateKey, 512)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  const { ciphertext, nonce } = body.wrappedPrivateKey;
  const result = await c.env.DB.prepare(
    `UPDATE accounts SET public_key = ?, wrapped_private_key = ?, identity_created_at = ?
      WHERE id = ? AND public_key IS NULL`,
  )
    .bind(
      body.publicKey,
      JSON.stringify({ ciphertext, nonce }),
      Math.floor(Date.now() / 1000),
      c.get("session").accountId,
    )
    .run();
  if (!result.meta.changes) {
    return c.json(apiError("account.identity_exists"), 409);
  }
  return c.json({ ok: true });
});

async function reauthenticated(
  env: AppBindings["Bindings"],
  accountId: string,
  currentAuthKey: unknown,
): Promise<boolean> {
  if (!isBase64(currentAuthKey, 32)) {
    return false;
  }
  const row = await env.DB.prepare("SELECT auth_key_hash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ auth_key_hash: string }>();
  return row !== null && (await verifyAuthKey(env, currentAuthKey, row.auth_key_hash)).matches;
}

account.get("/recovery", async (c) => {
  const row = await c.env.DB.prepare("SELECT recovery_created_at FROM accounts WHERE id = ?")
    .bind(c.get("session").accountId)
    .first<{ recovery_created_at: number | null }>();
  c.header("Cache-Control", "no-store");
  return c.json({ createdAt: row?.recovery_created_at ?? null });
});

account.put("/recovery", async (c) => {
  const body = await readJson(c);
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  if (!isBase64(body.authKey, 32)) {
    return c.json(apiError("auth.invalid_auth_key"), 400);
  }
  if (!isSealed(body.wrappedVaultKey, 64)) {
    return c.json(apiError("auth.invalid_wrapped_key"), 400);
  }
  const createdAt = now();
  await c.env.DB.prepare(
    `UPDATE accounts
        SET recovery_auth_hash = ?, recovery_wrapped_key = ?, recovery_nonce = ?,
            recovery_created_at = ?
      WHERE id = ?`,
  )
    .bind(
      await protectAuthKey(c.env, body.authKey),
      await protectWrappedKey(c.env, recoveryScope(accountId), body.wrappedVaultKey.ciphertext),
      body.wrappedVaultKey.nonce,
      createdAt,
      accountId,
    )
    .run();
  return c.json({ createdAt });
});

account.delete("/recovery", async (c) => {
  const body = await readJson(c);
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  await c.env.DB.prepare(
    `UPDATE accounts
        SET recovery_auth_hash = NULL, recovery_wrapped_key = NULL, recovery_nonce = NULL,
            recovery_created_at = NULL
      WHERE id = ?`,
  )
    .bind(accountId)
    .run();
  return c.json({ ok: true });
});

account.get("/2fa", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await twoFactorStatus(c.env, c.get("session").accountId));
});

async function accountEmail(env: AppBindings["Bindings"], accountId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ email: string }>();
  return row?.email ?? "";
}

function notify(
  c: Context<AppBindings>,
  email: string,
  locale: unknown,
  render: typeof twoFactorEnabledEmail,
): void {
  const mailer = createMailer(c.env);
  if (!mailer || !email) {
    return;
  }
  const message = render({ locale: requestLocale(c, locale), siteUrl: new URL(c.req.url).origin });
  inBackground(c, "two_factor_email_failed", () => mailer.send({ to: email, ...message }));
}

async function checkCode(
  c: Context<AppBindings>,
  accountId: string,
  code: unknown,
): Promise<Response | null> {
  const timestamp = now();
  const email = await accountEmail(c.env, accountId);
  const guard = await throttle(c.env, "two_factor", email, clientIp(c), timestamp);
  if (guard.retryAfter) {
    return c.json(apiError("auth.rate_limited", { seconds: guard.retryAfter }), 429);
  }
  await guard.slowDown();
  if (!(await verifySecondFactor(c.env, accountId, code, timestamp))) {
    await guard.fail();
    return c.json(apiError("auth.invalid_2fa"), 401);
  }
  await guard.clear();
  return null;
}

account.post("/2fa/setup", async (c) => {
  const body = await readJson(c);
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  if ((await twoFactorStatus(c.env, accountId)).enabled) {
    return c.json(apiError("two_factor.already_enabled"), 409);
  }
  c.header("Cache-Control", "no-store");
  return c.json(await startSetup(c.env, accountId, await accountEmail(c.env, accountId), now()));
});

account.post("/2fa/enable", async (c) => {
  const body = await readJson(c);
  const { accountId, tokenHash } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  const result = await confirmSetup(c.env, accountId, body.code, now());
  if (!result.ok) {
    if (result.reason === "enabled") {
      return c.json(apiError("two_factor.already_enabled"), 409);
    }
    if (result.reason === "expired") {
      return c.json(apiError("two_factor.setup_expired"), 400);
    }
    return c.json(apiError("auth.invalid_2fa"), 400);
  }
  await revokeOtherSessions(c.env, accountId, tokenHash);
  notify(c, await accountEmail(c.env, accountId), body.locale, twoFactorEnabledEmail);
  c.header("Cache-Control", "no-store");
  return c.json({ enabledAt: result.enabledAt, backupCodes: result.backupCodes });
});

account.post("/2fa/disable", async (c) => {
  const body = await readJson(c);
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  if (!(await twoFactorStatus(c.env, accountId)).enabled) {
    return c.json(apiError("two_factor.not_enabled"), 409);
  }
  const refused = await checkCode(c, accountId, body.code);
  if (refused) {
    return refused;
  }
  await c.env.DB.batch(disableStatements(c.env, accountId));
  notify(c, await accountEmail(c.env, accountId), body.locale, twoFactorDisabledEmail);
  return c.json({ ok: true });
});

account.post("/2fa/backup-codes", async (c) => {
  const body = await readJson(c);
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  if (!(await twoFactorStatus(c.env, accountId)).enabled) {
    return c.json(apiError("two_factor.not_enabled"), 409);
  }
  const refused = await checkCode(c, accountId, body.code);
  if (refused) {
    return refused;
  }
  c.header("Cache-Control", "no-store");
  return c.json({ backupCodes: await regenerateBackupCodes(c.env, accountId, now()) });
});

export default account;
