import { sameSecret } from "#core/primitives.js";
import { Hono } from "hono";
import { protectAuthKey, protectWrappedKey } from "#worker/at-rest.js";
import { authExtensions } from "#worker/auth-extensions.js";
import { deviceLabel } from "#worker/device-label.js";
import { normalizeEmail } from "#worker/email-address.js";
import {
  emailVerificationEnabled,
  issueCode,
  sendCode,
  verificationCodeError,
} from "#worker/email-verification.js";
import { apiError } from "#worker/errors.js";
import { now } from "#worker/clock.js";
import { inBackground, readJson } from "#worker/http.js";
import { keyedHash } from "#worker/keyed-hash.js";
import { createMailer } from "#worker/mailer.js";
import { CODE_RESEND_COOLDOWN_SECONDS } from "#worker/one-time-code.js";
import { OrgDirectory } from "#worker/orgs/directory.js";
import { joinFromInvite } from "#worker/orgs/invitations.js";
import { clientIp, isOpenRegistration } from "#worker/request.js";
import { createSession, decoySession, noteDevice } from "#worker/session.js";
import type { AppBindings, Env } from "#worker/types.js";
import { isBase64, isBase64Url, isKdf, isSealed, isUuid } from "#worker/validate.js";

const routes = new Hono<AppBindings>();

const MAX_ACCOUNTS_PER_IP_PER_DAY = 5;

routes.post("/register", async (c) => {
  const body = await readJson(c);
  const { email: rawEmail, kdf, authKey, wrappedVaultKey, verificationCode, inviteId } = body;
  const email = normalizeEmail(rawEmail);
  const externalGrant = isBase64Url(body.ssoGrant, 128) ? body.ssoGrant : null;
  const directory = new OrgDirectory(c.env.DB);
  const invite = isUuid(inviteId) ? await directory.preview(inviteId) : null;
  const invited = invite !== null && invite.email === email && invite.domainAllowed;

  const openRegistration = isOpenRegistration(c.env);
  if (!openRegistration && !invited && !externalGrant) {
    const provided = c.req.header("x-registration-token") ?? "";
    const expected = c.env.REGISTRATION_TOKEN;
    if (!expected || !(await sameSecret(provided, expected))) {
      return c.json(apiError("auth.bad_registration_token"), 403);
    }
  }

  if (!email) {
    return c.json(apiError("auth.invalid_email"), 400);
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

  const timestamp = now();
  const external = externalGrant
    ? await authExtensions().externalRegistration({ env: c.env, url: c.req.url }, externalGrant)
    : null;
  if (externalGrant && external?.email !== email) {
    return c.json(apiError("sso.expired"), 403);
  }
  const codeError = external
    ? null
    : await verificationCodeError(c.env, email, verificationCode, timestamp);
  if (codeError) {
    return c.json(apiError(codeError), 400);
  }
  if (
    openRegistration &&
    !external &&
    !(await claimRegistrationSlot(c.env, clientIp(c), timestamp))
  ) {
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
    if (!String(error).includes("UNIQUE")) {
      throw error;
    }
    if (external || emailVerificationEnabled(c.env)) {
      return c.json(apiError("auth.email_taken"), 409);
    }
    return c.json({ accountId: crypto.randomUUID(), ...decoySession(timestamp) }, 201);
  }

  const label = deviceLabel(c.req.header("User-Agent"));
  const session = await createSession(c.env, accountId, timestamp, label);
  await noteDevice(c.env, accountId, label, timestamp);
  const joined = external
    ? await external.join(accountId, clientIp(c))
    : invited
      ? await joinFromInvite(c.env, directory, {
          id: inviteId as string,
          email,
          accountId,
          ip: clientIp(c),
          url: c.req.url,
        })
      : null;
  const orgId = joined && joined !== "domain" && joined !== "policy" ? joined : null;
  return c.json({ accountId, ...session, ...(orgId ? { orgId } : {}) }, 201);
});

routes.post("/verify-email", async (c) => {
  const mailer = createMailer(c.env);
  if (!mailer) {
    return c.json({ ok: true, required: false });
  }

  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!email) {
    return c.json(apiError("auth.invalid_email"), 400);
  }
  const request = {
    email,
    locale: body.locale === "vi" ? ("vi" as const) : ("en" as const),
    siteUrl: new URL(c.req.url).origin,
  };

  const issued = await issueCode(c.env, email, now());
  if (issued === "cooldown") {
    return c.json(apiError("auth.code_cooldown", { seconds: CODE_RESEND_COOLDOWN_SECONDS }), 429);
  }
  inBackground(c, "verification_email_failed", () => sendCode(c.env, mailer, request, issued.code));
  return c.json({ ok: true, required: true });
});

async function claimRegistrationSlot(env: Env, ip: string, timestamp: number): Promise<boolean> {
  const ipHash = await keyedHash(env.EMAIL_PROBE_SECRET, `registration-ip:${ip}`);
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

export default routes;
