import { Hono } from "hono";
import { protectAuthKey, protectWrappedKey, verifyAuthKey } from "#worker/at-rest.js";
import { apiError } from "#worker/errors.js";
import { readJson } from "#worker/http.js";
import { revokeAllSessions, revokeOtherSessions } from "#worker/session.js";
import type { AppBindings } from "#worker/types.js";
import { isBase64, isKdf, isSealed } from "#worker/validate.js";

const routes = new Hono<AppBindings>();

routes.post("/change-password", async (c) => {
  const { currentAuthKey, kdf, authKey, wrappedVaultKey, keepSession } = await readJson(c);
  if (!isBase64(currentAuthKey, 32)) {
    return c.json(apiError("auth.invalid_credentials"), 400);
  }
  if (!isKdf(kdf)) {
    return c.json(apiError("auth.invalid_kdf"), 400);
  }
  if (!isBase64(authKey, 32)) {
    return c.json(apiError("auth.invalid_auth_key"), 400);
  }
  if (!isSealed(wrappedVaultKey, 64)) {
    return c.json(apiError("auth.invalid_wrapped_key"), 400);
  }

  const { accountId, tokenHash } = c.get("session");
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
  if (!result.meta.changes) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }

  if (keepSession === true) {
    await revokeOtherSessions(c.env, accountId, tokenHash);
  } else {
    await revokeAllSessions(c.env, accountId);
  }
  return c.json({ ok: true });
});

export default routes;
