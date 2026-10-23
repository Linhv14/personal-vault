import { Hono, type MiddlewareHandler } from "hono";
import { emailDomain } from "#core/org-model.js";
import { openServerSecret } from "#worker/at-rest.js";
import { now } from "#worker/clock.js";
import { normalizeEmail } from "#worker/email-address.js";
import { apiError, type ApiErrorCode } from "#worker/errors.js";
import { readJson } from "#worker/http.js";
import { clientIp, requestLocale } from "#worker/request.js";
import { hashToken } from "#worker/session.js";
import { signedIn } from "#worker/sign-in.js";
import type { AppBindings } from "#worker/types.js";
import { isBase64Url } from "#worker/validate.js";
import {
  callbackUrl,
  isAllowedReturn,
  isLoopbackReturn,
  normalizeIdentifier,
  returnTargets,
} from "#commercial/core/sso-model.js";
import {
  authorizationUrl,
  backTo,
  CLIENT_SECRET_PURPOSE,
  CODE_VERIFIER_PURPOSE,
  origin,
  ready,
  token,
} from "./authorize.js";
import { ssoAvailable } from "./availability.js";
import { ssoEnv } from "./env.js";
import { ssoFetcher } from "./fetcher.js";
import { completeLink } from "./links.js";
import { joinOrg } from "./membership.js";
import { pkceChallenge } from "#core/pkce.js";
import { discover, exchangeCode, jwksSource, verifyIdToken } from "./oidc.js";
import { SsoStore } from "./store.js";

const SESSION_GRANT_TTL_SECONDS = 120;
const REGISTER_GRANT_TTL_SECONDS = 900;

const routes = new Hono<AppBindings>();

const limitByClientIp: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { success } = await c.env.ANONYMOUS_RATE_LIMITER.limit({ key: `sso:${clientIp(c)}` });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }
  await next();
};

routes.use("*", limitByClientIp);

async function findConfig(store: SsoStore, body: Record<string, unknown>) {
  const identifier = normalizeIdentifier(body.identifier);
  if (identifier) {
    return store.configByIdentifier(identifier);
  }
  const email = normalizeEmail(body.email);
  if (!email) {
    return undefined;
  }
  const orgId = await store.orgOfVerifiedDomain(emailDomain(email));
  return orgId ? store.config(orgId) : null;
}

routes.post("/prepare", async (c) => {
  const body = await readJson(c);
  const targets = returnTargets(origin(c), ssoEnv(c.env).SSO_EXTENSION_IDS);
  if (!isAllowedReturn(body.returnTo, targets) && !isLoopbackReturn(body.returnTo)) {
    return c.json(apiError("sso.invalid_return"), 400);
  }
  if (!isBase64Url(body.clientChallenge, 64) || body.clientChallenge.length !== 43) {
    return c.json(apiError("sso.invalid_request"), 400);
  }
  const store = new SsoStore(c.env.DB);
  const config = await findConfig(store, body);
  if (config === undefined) {
    return c.json(apiError("sso.invalid_request"), 400);
  }
  if (!ready(config)) {
    return c.json(apiError("sso.not_found"), 404);
  }
  const org = await store.orgPlan(config.orgId);
  if (!org) {
    return c.json(apiError("sso.not_found"), 404);
  }
  if (!(await ssoAvailable(c.env, c.req.url, org.plan))) {
    return c.json(apiError("license.required"), 403);
  }
  const authorizeUrl = await authorizationUrl(c, store, config, {
    returnTo: body.returnTo,
    clientChallenge: body.clientChallenge,
    loginHint: normalizeEmail(body.email),
    linkAccountId: null,
  });
  if (!authorizeUrl) {
    return c.json(apiError("sso.discovery_failed"), 502);
  }
  return c.json({
    orgName: org.name,
    identifier: config.identifier,
    authorizeUrl,
  });
});

routes.get("/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  if (!isBase64Url(state, 64)) {
    return c.json(apiError("sso.expired"), 400);
  }
  const store = new SsoStore(c.env.DB);
  const pending = await store.takeState(await hashToken(state));
  if (!pending) {
    return c.json(apiError("sso.expired"), 400);
  }
  const fail = (code: ApiErrorCode) => backTo(c, pending.returnTo, { sso_error: code });
  const code = c.req.query("code");
  if (c.req.query("error") || !code || code.length > 4096) {
    return fail("sso.failed");
  }
  const config = await store.config(pending.orgId);
  const org = await store.orgPlan(pending.orgId);
  if (!ready(config) || !org) {
    return fail("sso.not_found");
  }
  if (!(await ssoAvailable(c.env, c.req.url, org.plan))) {
    return fail("license.required");
  }
  const fetcher = ssoFetcher(c.env, c.req.url);
  const metadata = await discover(fetcher, config.issuer);
  const [codeVerifier, clientSecret] = await Promise.all([
    openServerSecret(c.env, CODE_VERIFIER_PURPOSE, pending.codeVerifier),
    openServerSecret(c.env, CLIENT_SECRET_PURPOSE, config.clientSecret),
  ]);
  if (!metadata || !codeVerifier || !clientSecret) {
    return fail("sso.failed");
  }
  const idToken = await exchangeCode(fetcher, metadata, {
    code,
    codeVerifier,
    redirectUri: callbackUrl(origin(c)),
    clientId: config.clientId,
    clientSecret,
  });
  if (!idToken) {
    return fail("sso.failed");
  }
  const checked = await verifyIdToken(idToken, {
    issuer: metadata.issuer,
    clientId: config.clientId,
    nonce: pending.nonce,
    now: now(),
    jwks: jwksSource(fetcher, metadata.jwksUri),
  });
  if (!checked.ok) {
    return fail(checked.code);
  }
  if (pending.linkAccountId) {
    return completeLink(c, store, {
      orgId: pending.orgId,
      accountId: pending.linkAccountId,
      returnTo: pending.returnTo,
      identity: { issuer: metadata.issuer, subject: checked.subject, email: checked.email },
    });
  }
  const email = (await store.verifiedDomainOf(pending.orgId, emailDomain(checked.email)))
    ? checked.email
    : await store.linkedEmail(pending.orgId, metadata.issuer, checked.subject);
  if (!email) {
    return fail("sso.email_not_allowed");
  }
  const grant = token();
  await store.putGrant(
    await hashToken(grant),
    "session",
    { orgId: pending.orgId, email, clientChallenge: pending.clientChallenge },
    SESSION_GRANT_TTL_SECONDS,
  );
  return backTo(c, pending.returnTo, { sso_grant: grant });
});

routes.post("/session", async (c) => {
  const body = await readJson(c);
  const { grant, clientVerifier } = body;
  if (!isBase64Url(grant, 64) || !isBase64Url(clientVerifier, 128)) {
    return c.json(apiError("sso.expired"), 403);
  }
  const store = new SsoStore(c.env.DB);
  const claim = await store.takeGrant(await hashToken(grant), "session");
  if (!claim || claim.clientChallenge !== (await pkceChallenge(clientVerifier))) {
    return c.json(apiError("sso.expired"), 403);
  }
  const org = await store.orgPlan(claim.orgId);
  const config = await store.config(claim.orgId);
  if (!ready(config) || !org) {
    return c.json(apiError("sso.not_found"), 404);
  }
  if (!(await ssoAvailable(c.env, c.req.url, org.plan))) {
    return c.json(apiError("license.required"), 403);
  }
  const trusted =
    (await store.verifiedDomainOf(claim.orgId, emailDomain(claim.email))) ||
    (await store.hasLinkForEmail(claim.orgId, config.issuer, claim.email));
  if (!trusted) {
    return c.json(apiError("sso.email_not_allowed"), 403);
  }
  const account = await c.env.DB.prepare(
    "SELECT id, kdf_type, kdf_iterations, kdf_salt FROM accounts WHERE email = ?",
  )
    .bind(claim.email)
    .first<{ id: string; kdf_type: string; kdf_iterations: number; kdf_salt: string }>();
  if (!account) {
    const registrationGrant = token();
    await store.putGrant(
      await hashToken(registrationGrant),
      "register",
      { orgId: claim.orgId, email: claim.email, clientChallenge: null },
      REGISTER_GRANT_TTL_SECONDS,
    );
    return c.json({
      status: "register",
      email: claim.email,
      orgName: org.name,
      registrationGrant,
    });
  }
  const joined = await joinOrg(
    { env: c.env, url: c.req.url },
    { orgId: claim.orgId, accountId: account.id, email: claim.email, ip: clientIp(c) },
  );
  if ("refused" in joined) {
    return c.json(apiError(joined.refused), 403);
  }
  const locale = requestLocale(c, body.locale);
  const session = await signedIn(c, account.id, claim.email, locale, now());
  return c.json({
    status: "signed_in",
    email: claim.email,
    orgId: joined.orgId,
    kdf: { type: account.kdf_type, iterations: account.kdf_iterations, salt: account.kdf_salt },
    ...session,
  });
});

export default routes;
