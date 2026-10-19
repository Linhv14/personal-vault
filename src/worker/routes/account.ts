import { Hono } from "hono";
import { isPublicKey } from "../../core/identity.js";
import { protectAuthKey, protectWrappedKey, recoveryScope, verifyAuthKey } from "../at-rest.js";
import { apiError } from "../errors.js";
import { now } from "../http.js";
import { isBase64, isSealed } from "../validate.js";
import type { AppBindings } from "../types.js";

const account = new Hono<AppBindings>();

account.get("/identity", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT public_key, wrapped_private_key FROM accounts WHERE id = ?",
  )
    .bind(c.get("session").accountId)
    .first<{ public_key: string | null; wrapped_private_key: string | null }>();
  c.header("Cache-Control", "no-store");
  if (!row?.public_key || !row.wrapped_private_key) return c.json({ identity: null });
  return c.json({
    identity: {
      publicKey: row.public_key,
      wrappedPrivateKey: JSON.parse(row.wrapped_private_key) as unknown,
    },
  });
});

account.put("/identity", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    publicKey?: unknown;
    wrappedPrivateKey?: unknown;
  } | null;
  if (!isPublicKey(body?.publicKey) || !isSealed(body?.wrappedPrivateKey, 512)) {
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
  if (!result.meta.changes) return c.json(apiError("account.identity_exists"), 409);
  return c.json({ ok: true });
});

async function reauthenticated(
  env: AppBindings["Bindings"],
  accountId: string,
  currentAuthKey: unknown,
): Promise<boolean> {
  if (!isBase64(currentAuthKey, 32)) return false;
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
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body?.currentAuthKey))) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }
  if (!isBase64(body?.authKey, 32)) return c.json(apiError("auth.invalid_auth_key"), 400);
  if (!isSealed(body?.wrappedVaultKey, 64)) {
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
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const { accountId } = c.get("session");
  if (!(await reauthenticated(c.env, accountId, body?.currentAuthKey))) {
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

export default account;
