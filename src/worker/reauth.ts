import type { Context } from "hono";
import { verifyAuthKey } from "./at-rest.js";
import { now } from "./clock.js";
import { apiError } from "./errors.js";
import { clientIp } from "./request.js";
import { throttle } from "./throttle.js";
import { verifySecondFactor } from "./two-factor.js";
import type { AppBindings } from "./types.js";
import { isBase64 } from "./validate.js";

export async function reauthenticated(
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

export async function accountEmail(
  env: AppBindings["Bindings"],
  accountId: string,
): Promise<string> {
  const row = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ email: string }>();
  return row?.email ?? "";
}

export async function checkSecondFactor(
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
