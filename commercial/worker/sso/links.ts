import { Hono } from "hono";
import { emailDomain } from "#core/org-model.js";
import { orgStore } from "#worker/durable-objects.js";
import { ssoLinkedEmail } from "#worker/emails.js";
import { apiError, type ApiErrorCode } from "#worker/errors.js";
import { inBackground, readJson } from "#worker/http.js";
import { createMailer } from "#worker/mailer.js";
import { OrgDirectory } from "#worker/orgs/directory.js";
import { configuredPrivacyUrl } from "#worker/privacy-link.js";
import { accountEmail, checkSecondFactor, reauthenticated } from "#worker/reauth.js";
import { clientIp, requestLocale } from "#worker/request.js";
import { asMember, type Ctx } from "#worker/routes/org-access.js";
import { twoFactorStatus } from "#worker/two-factor.js";
import type { AppBindings } from "#worker/types.js";
import { isAllowedReturn, returnTargets } from "#commercial/core/sso-model.js";
import { authorizationUrl, backTo, origin, ready } from "./authorize.js";
import { ssoAvailable } from "./availability.js";
import { ssoEnv } from "./env.js";
import { SsoStore } from "./store.js";

const links = new Hono<AppBindings>();

async function linkStatus(c: Ctx, orgId: string, accountId: string) {
  const store = new SsoStore(c.env.DB);
  const [org, config, link, email, twoFactor] = await Promise.all([
    store.orgPlan(orgId),
    store.config(orgId),
    store.link(orgId, accountId),
    accountEmail(c.env, accountId),
    twoFactorStatus(c.env, accountId),
  ]);
  const available =
    ready(config) && org !== null && (await ssoAvailable(c.env, c.req.url, org.plan));
  return {
    available,
    onDomain: await store.verifiedDomainOf(orgId, emailDomain(email)),
    twoFactor: twoFactor.enabled,
    link: link && config?.issuer === link.issuer ? { linkedAt: link.linkedAt } : null,
  };
}

links.get(
  "/",
  asMember(async (c, member, orgId) => c.json(await linkStatus(c, orgId, member.accountId))),
);

links.post(
  "/",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const targets = returnTargets(origin(c), ssoEnv(c.env).SSO_EXTENSION_IDS);
    if (!isAllowedReturn(body.returnTo, targets)) {
      return c.json(apiError("sso.invalid_return"), 400);
    }
    const { accountId } = member;
    if (!(await reauthenticated(c.env, accountId, body.currentAuthKey))) {
      return c.json(apiError("auth.invalid_credentials"), 403);
    }
    if ((await twoFactorStatus(c.env, accountId)).enabled) {
      const refused = await checkSecondFactor(c, accountId, body.code);
      if (refused) {
        return refused;
      }
    }
    const store = new SsoStore(c.env.DB);
    const [config, org, email] = await Promise.all([
      store.config(orgId),
      store.orgPlan(orgId),
      accountEmail(c.env, accountId),
    ]);
    if (!ready(config) || !org) {
      return c.json(apiError("sso.not_found"), 404);
    }
    if (!(await ssoAvailable(c.env, c.req.url, org.plan))) {
      return c.json(apiError("license.required"), 403);
    }
    if (await store.verifiedDomainOf(orgId, emailDomain(email))) {
      return c.json(apiError("sso.invalid_request"), 409);
    }
    const authorizeUrl = await authorizationUrl(c, store, config, {
      returnTo: body.returnTo,
      clientChallenge: "",
      loginHint: email,
      linkAccountId: accountId,
    });
    if (!authorizeUrl) {
      return c.json(apiError("sso.discovery_failed"), 502);
    }
    return c.json({ authorizeUrl });
  }),
);

links.delete(
  "/",
  asMember(async (c, member, orgId) => {
    if (await new SsoStore(c.env.DB).removeLink(orgId, member.accountId)) {
      await orgStore(c.env, orgId).note(member.accountId, "member.sso_unlinked", null, clientIp(c));
    }
    return c.json(await linkStatus(c, orgId, member.accountId));
  }),
);

function notifyLinked(c: Ctx, email: string, orgName: string): void {
  const mailer = createMailer(c.env);
  if (!mailer) {
    return;
  }
  const message = ssoLinkedEmail(
    {
      locale: requestLocale(c, undefined),
      siteUrl: origin(c),
      privacyUrl: configuredPrivacyUrl(c.env),
    },
    orgName,
  );
  inBackground(c, "sso_linked_email_failed", () => mailer.send({ to: email, ...message }));
}

export async function completeLink(
  c: Ctx,
  store: SsoStore,
  attempt: {
    orgId: string;
    accountId: string;
    returnTo: string;
    identity: { issuer: string; subject: string; email: string };
  },
): Promise<Response> {
  const { orgId, accountId, returnTo, identity } = attempt;
  const fail = (code: ApiErrorCode) => backTo(c, returnTo, { sso_link_error: code });
  const [email, role, org] = await Promise.all([
    accountEmail(c.env, accountId),
    new OrgDirectory(c.env.DB).roleOf(orgId, accountId),
    store.orgPlan(orgId),
  ]);
  if (!email || !role || !org) {
    return fail("sso.not_found");
  }
  if (identity.email !== email) {
    return fail("sso.link_email_mismatch");
  }
  if ((await store.saveLink(orgId, accountId, identity)) === "taken") {
    return fail("sso.link_taken");
  }
  await orgStore(c.env, orgId).note(accountId, "member.sso_linked", null, clientIp(c));
  notifyLinked(c, email, org.name);
  return backTo(c, returnTo, { sso_link: "linked" });
}

export default links;
