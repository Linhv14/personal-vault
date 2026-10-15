import { Hono } from "hono";
import { isPublicKey } from "../../core/identity.js";
import { apiError } from "../errors.js";
import { isSealed } from "../validate.js";
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

export default account;
