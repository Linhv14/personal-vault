import { Hono } from "hono";
import { verifyAuthKey } from "#worker/at-rest.js";
import { apiError } from "#worker/errors.js";
import { readJson } from "#worker/http.js";
import { OrgDirectory } from "#worker/orgs/directory.js";
import { orgStore, userStore } from "#worker/durable-objects.js";
import type { AppBindings } from "#worker/types.js";
import { isBase64 } from "#worker/validate.js";

const routes = new Hono<AppBindings>();

routes.post("/delete-account", async (c) => {
  const { currentAuthKey } = await readJson(c);
  if (!isBase64(currentAuthKey, 32)) {
    return c.json(apiError("auth.invalid_credentials"), 400);
  }

  const { accountId } = c.get("session");
  const row = await c.env.DB.prepare("SELECT email, auth_key_hash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ email: string; auth_key_hash: string }>();
  if (!row || !(await verifyAuthKey(c.env, currentAuthKey, row.auth_key_hash)).matches) {
    return c.json(apiError("auth.invalid_credentials"), 403);
  }

  for (const orgId of await new OrgDirectory(c.env.DB).orgIdsOf(accountId)) {
    await orgStore(c.env, orgId).removeMember(accountId, accountId, null);
  }
  await userStore(c.env, accountId).destroy(accountId);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM items WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(row.email),
    c.env.DB.prepare("DELETE FROM two_factor_backup_codes WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM two_factor_challenges WHERE account_id = ?").bind(accountId),
    c.env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId),
  ]);
  return c.json({ ok: true });
});

export default routes;
