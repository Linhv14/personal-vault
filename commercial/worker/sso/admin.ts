import { Hono } from "hono";
import { randomBytes, toBase64Url } from "#core/bytes.js";
import { normalizeDomain, type Principal } from "#core/org-model.js";
import { sealServerSecret } from "#worker/at-rest.js";
import { orgStore } from "#worker/durable-objects.js";
import { apiError } from "#worker/errors.js";
import { readJson } from "#worker/http.js";
import { clientIp } from "#worker/request.js";
import { admins, asMember, notFound, param, type Ctx } from "#worker/routes/org-access.js";
import type { AppBindings } from "#worker/types.js";
import {
  callbackUrl,
  DECRYPTION_OPTIONS,
  domainRecord,
  isDecryptionOption,
  MAX_SSO_DOMAINS,
  normalizeIdentifier,
} from "#commercial/core/sso-model.js";
import { CLIENT_SECRET_PURPOSE } from "./authorize.js";
import { licenseStatus, ssoAvailable } from "./availability.js";
import { txtRecords } from "./dns.js";
import { ssoFetcher } from "./fetcher.js";
import { discover, normalizeIssuer } from "./oidc.js";
import { SsoStore } from "./store.js";

const admin = new Hono<AppBindings>();
const store = (c: Ctx) => new SsoStore(c.env.DB);

type AdminHandler = (c: Ctx, member: Principal, orgId: string) => Promise<Response>;

function licensed(handler: AdminHandler) {
  return asMember(async (c, member, orgId) => {
    const org = await store(c).orgPlan(orgId);
    if (!(await ssoAvailable(c.env, c.req.url, org?.plan))) {
      return c.json(apiError("license.required"), 403);
    }
    return handler(c, member, orgId);
  }, admins);
}

async function audit(c: Ctx, member: Principal, orgId: string, action: string, target: string) {
  await orgStore(c.env, orgId).note(member.accountId, action, target, clientIp(c));
}

async function overview(c: Ctx, orgId: string) {
  const [org, config, domains, license] = await Promise.all([
    store(c).orgPlan(orgId),
    store(c).config(orgId),
    store(c).domains(orgId),
    licenseStatus(c.env, c.req.url),
  ]);
  return {
    available: await ssoAvailable(c.env, c.req.url, org?.plan),
    plan: org?.plan ?? "free",
    license:
      license.status === "valid" || license.status === "expired"
        ? {
            status: license.status,
            licensee: license.license.licensee,
            seats: license.license.seats,
            expiresAt: license.license.expiresAt,
          }
        : { status: license.status },
    identifier: config?.identifier ?? null,
    redirectUri: callbackUrl(new URL(c.req.url).origin),
    decryptionOptions: DECRYPTION_OPTIONS,
    provider:
      config?.issuer && config.clientId
        ? {
            issuer: config.issuer,
            clientId: config.clientId,
            hasSecret: Boolean(config.clientSecret),
            enabled: config.enabled,
            decryption: config.decryption,
          }
        : null,
    policies: { requireSso: config?.requireSso ?? false, singleOrg: config?.singleOrg ?? false },
    domains: domains.map((entry) => ({
      domain: entry.domain,
      record: domainRecord(entry.token),
      verified: entry.verifiedAt !== null,
      verifiedAt: entry.verifiedAt,
      checkedAt: entry.checkedAt,
    })),
  };
}

admin.get(
  "/",
  asMember(async (c, _member, orgId) => c.json(await overview(c, orgId)), admins),
);

admin.put(
  "/identifier",
  licensed(async (c, member, orgId) => {
    const identifier = normalizeIdentifier((await readJson(c)).identifier);
    if (!identifier) {
      return c.json(apiError("sso.invalid_identifier"), 400);
    }
    if ((await store(c).setIdentifier(orgId, identifier)) === "taken") {
      return c.json(apiError("sso.identifier_taken"), 409);
    }
    await audit(c, member, orgId, "org.sso_identifier_set", identifier);
    return c.json(await overview(c, orgId));
  }),
);

admin.post(
  "/domains",
  licensed(async (c, member, orgId) => {
    const domain = normalizeDomain((await readJson(c)).domain);
    if (!domain) {
      return c.json(apiError("sso.invalid_domain"), 400);
    }
    const existing = await store(c).domains(orgId);
    if (!existing.some((entry) => entry.domain === domain)) {
      if (existing.length >= MAX_SSO_DOMAINS) {
        return c.json(apiError("sso.domain_limit"), 409);
      }
      const owner = await store(c).orgOfVerifiedDomain(domain);
      if (owner && owner !== orgId) {
        return c.json(apiError("sso.domain_taken"), 409);
      }
      await store(c).addDomain(orgId, domain, toBase64Url(randomBytes(24)));
      await audit(c, member, orgId, "org.sso_domain_added", domain);
    }
    return c.json(await overview(c, orgId), 201);
  }),
);

admin.post(
  "/domains/:domain/verify",
  licensed(async (c, member, orgId) => {
    const domain = normalizeDomain(param(c, "domain"));
    const entry = (await store(c).domains(orgId)).find((row) => row.domain === domain);
    if (!domain || !entry) {
      return notFound(c);
    }
    if (entry.verifiedAt !== null) {
      return c.json(await overview(c, orgId));
    }
    const owner = await store(c).orgOfVerifiedDomain(domain);
    if (owner && owner !== orgId) {
      return c.json(apiError("sso.domain_taken"), 409);
    }
    const records = await txtRecords(ssoFetcher(c.env, c.req.url), domain);
    const found = records?.includes(domainRecord(entry.token)) ?? false;
    if ((await store(c).markChecked(orgId, domain, found)) === "taken") {
      return c.json(apiError("sso.domain_taken"), 409);
    }
    if (!found) {
      return c.json(apiError("sso.domain_not_verified"), 400);
    }
    await audit(c, member, orgId, "org.sso_domain_verified", domain);
    return c.json(await overview(c, orgId));
  }),
);

admin.delete(
  "/domains/:domain",
  asMember(async (c, member, orgId) => {
    const domain = normalizeDomain(param(c, "domain"));
    if (!domain || !(await store(c).removeDomain(orgId, domain))) {
      return notFound(c);
    }
    await audit(c, member, orgId, "org.sso_domain_removed", domain);
    return c.json(await overview(c, orgId));
  }, admins),
);

const MAX_CLIENT_FIELD = 512;

admin.put(
  "/provider",
  licensed(async (c, member, orgId) => {
    const body = await readJson(c);
    const issuer = normalizeIssuer(body.issuer);
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const secret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    const decryption = body.decryption ?? "master_password";
    const current = await store(c).config(orgId);
    if (
      !issuer ||
      !clientId ||
      clientId.length > MAX_CLIENT_FIELD ||
      secret.length > MAX_CLIENT_FIELD ||
      (!secret && !current?.clientSecret) ||
      typeof body.enabled !== "boolean" ||
      !isDecryptionOption(decryption)
    ) {
      return c.json(apiError("sso.invalid_provider"), 400);
    }
    const metadata = await discover(ssoFetcher(c.env, c.req.url), issuer);
    if (!metadata) {
      return c.json(apiError("sso.discovery_failed"), 400);
    }
    await store(c).setProvider(orgId, {
      issuer: metadata.issuer,
      clientId,
      clientSecret: secret ? await sealServerSecret(c.env, CLIENT_SECRET_PURPOSE, secret) : null,
      enabled: body.enabled,
      decryption,
    });
    await audit(
      c,
      member,
      orgId,
      "org.sso_provider_saved",
      `${new URL(metadata.issuer).host} ${body.enabled ? "on" : "off"}`,
    );
    return c.json(await overview(c, orgId));
  }),
);

admin.put(
  "/policies",
  licensed(async (c, member, orgId) => {
    const body = await readJson(c);
    const { requireSso, singleOrg } = body;
    if (typeof requireSso !== "boolean" || typeof singleOrg !== "boolean") {
      return c.json(apiError("sso.invalid_request"), 400);
    }
    if (requireSso && !(await store(c).config(orgId))?.enabled) {
      return c.json(apiError("sso.invalid_provider"), 400);
    }
    await store(c).setPolicies(orgId, { requireSso, singleOrg });
    await audit(
      c,
      member,
      orgId,
      "org.sso_policies_changed",
      `require_sso=${requireSso ? "on" : "off"} single_org=${singleOrg ? "on" : "off"}`,
    );
    return c.json(await overview(c, orgId));
  }),
);

export default admin;
