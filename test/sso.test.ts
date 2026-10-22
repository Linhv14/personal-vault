import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, toBase64Url } from "../src/core/bytes.js";
import { OFFICIAL_EXTENSION_ID } from "../commercial/core/sso-model.js";
import { readJsonObject, stringField } from "./helpers.js";
import {
  addOrg,
  CLIENT_ID,
  CLIENT_SECRET,
  FakeIdp,
  fakeOrgStore,
  ISSUER,
  LICENSE_TEST_KEY,
  licenseFor,
  s256,
  signedInAccount,
} from "./sso-harness.js";
import {
  accountRecord,
  freezeClockAtT0,
  startWorker,
  T0,
  type TestWorker,
} from "./worker-harness.js";

const FETCHER = new URL("../commercial/worker/sso/fetcher.ts", import.meta.url).href;
const { setSsoFetcher } = (await import(FETCHER)) as {
  setSsoFetcher(fetcher: ((url: string, init?: RequestInit) => Promise<Response>) | null): void;
};

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const WEB_RETURN = "https://vault.test/app/";

let worker: TestWorker;
let idp: FakeIdp;
let audit: ReturnType<typeof fakeOrgStore>;
let owner: Awaited<ReturnType<typeof signedInAccount>>;

freezeClockAtT0();

async function json(response: Response) {
  return { status: response.status, body: await readJsonObject(response) };
}

async function start(plan = "enterprise", vars: Record<string, unknown> = {}) {
  audit = fakeOrgStore();
  worker = await startWorker({ vars: { ORG_STORE: audit.binding, ...vars } });
  owner = await signedInAccount(worker, "owner@acme.com");
  addOrg(worker, ORG, plan, [[owner.id, "owner"]]);
}

const admin = (path: string, method: string, body?: unknown, org = ORG, token = owner.token) =>
  worker
    .fetch(`/api/orgs/${org}/sso${path}`, { method, token, ...(body ? { json: body } : {}) })
    .then(json);

async function configure(org = ORG, token = owner.token) {
  expect((await admin("/identifier", "PUT", { identifier: "acme" }, org, token)).status).toBe(200);
  expect((await admin("/domains", "POST", { domain: "acme.com" }, org, token)).status).toBe(201);
  const overview = await admin("", "GET", undefined, org, token);
  const record = (overview.body.domains as { record: string }[])[0]!.record;
  idp.txt.set("acme.com", ["v=spf1 -all", record]);
  expect((await admin("/domains/acme.com/verify", "POST", undefined, org, token)).status).toBe(200);
  const saved = await admin(
    "/provider",
    "PUT",
    { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, enabled: true },
    org,
    token,
  );
  expect(saved.status).toBe(200);
}

interface Started {
  verifier: string;
  state: string;
  nonce: string;
  challenge: string;
  authorize: URL;
}

async function begin(body: Record<string, unknown> = { email: "member@acme.com" }) {
  const verifier = toBase64Url(randomBytes(32));
  const response = await worker
    .fetch("/api/sso/prepare", {
      method: "POST",
      json: { returnTo: WEB_RETURN, clientChallenge: await s256(verifier), ...body },
    })
    .then(json);
  return { response, verifier };
}

async function prepared(body?: Record<string, unknown>): Promise<Started> {
  const { response, verifier } = await begin(body);
  expect(response.status).toBe(200);
  const authorize = new URL(stringField(response.body, "authorizeUrl"));
  return {
    verifier,
    authorize,
    state: authorize.searchParams.get("state")!,
    nonce: authorize.searchParams.get("nonce")!,
    challenge: authorize.searchParams.get("code_challenge")!,
  };
}

function claims(started: Started, overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "idp-user-1",
    email: "member@acme.com",
    email_verified: true,
    nonce: started.nonce,
    iat: T0,
    exp: T0 + 300,
    ...overrides,
  };
}

async function callback(
  started: Started,
  overrides: Record<string, unknown> = {},
  options: { alg?: "RS256" | "ES256"; key?: CryptoKey; kid?: string } = {},
) {
  const code = toBase64Url(randomBytes(16));
  idp.codes.set(code, {
    claims: claims(started, overrides),
    challenge: started.challenge,
    ...options,
  });
  return worker.fetch(`/api/sso/callback?code=${code}&state=${started.state}`);
}

function outcome(response: Response) {
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("Location")!);
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    target: `${location.origin}${location.pathname}`,
    grant: params.get("sso_grant"),
    error: params.get("sso_error"),
  };
}

const session = (grant: string, clientVerifier: string) =>
  worker.fetch("/api/sso/session", { method: "POST", json: { grant, clientVerifier } }).then(json);

async function signInThroughSso(
  email = "member@acme.com",
  overrides = {},
  start: Record<string, unknown> = { email },
) {
  const started = await prepared(start);
  const { grant } = outcome(await callback(started, { email, ...overrides }));
  return session(grant!, started.verifier);
}

beforeEach(async () => {
  idp = await FakeIdp.create();
  setSsoFetcher(idp.fetch);
});

afterEach(() => setSsoFetcher(null));

describe("SSO licence", () => {
  it("answers license.required without the enterprise plan or a licence", async () => {
    await start("free");
    expect((await admin("/identifier", "PUT", { identifier: "acme" })).body.code).toBe(
      "license.required",
    );
    const overview = await admin("", "GET");
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ available: false, license: { status: "missing" } });
  });

  it("enables SSO for a licensed server, and never trusts the test key in production", async () => {
    const vars = {
      LICENSE_KEY: licenseFor(25),
      SSO_TEST_LICENSE_KEY: LICENSE_TEST_KEY.publicKey,
      SSO_TEST_ISSUER: "https://idp.test.invalid",
      CI_TEST_JWKS: "e30",
    };
    await start("free", vars);
    expect((await admin("", "GET")).body.license).toEqual({ status: "invalid" });
    const local = await worker
      .fetch(`http://127.0.0.1:8901/api/orgs/${ORG}/sso`, { token: owner.token })
      .then(json);
    expect(local.body).toMatchObject({
      available: true,
      license: { status: "valid", licensee: "Test Co", seats: 25 },
    });
  });

  it("stops SSO when a licence has expired", async () => {
    await start("free", {
      LICENSE_KEY: licenseFor(25, T0 - 1),
      SSO_TEST_LICENSE_KEY: LICENSE_TEST_KEY.publicKey,
      SSO_TEST_ISSUER: "https://idp.test.invalid",
      CI_TEST_JWKS: "e30",
    });
    const local = await worker
      .fetch(`http://127.0.0.1:8901/api/orgs/${ORG}/sso`, { token: owner.token })
      .then(json);
    expect(local.body).toMatchObject({ available: false, license: { status: "expired" } });
  });
});

describe("organization identifier and domains", () => {
  beforeEach(() => start());

  it("lets only owners and admins configure SSO", async () => {
    const member = await signedInAccount(worker, "member@acme.com");
    worker.d1.db
      .prepare("INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .run(ORG, member.id, "member", T0);
    const denied = await admin("/identifier", "PUT", { identifier: "acme" }, ORG, member.token);
    expect(denied.status).toBe(403);
    expect((await admin("", "GET", undefined, ORG, member.token)).status).toBe(403);
  });

  it("validates identifiers and keeps them unique", async () => {
    for (const identifier of ["ab", "Acme Corp", "a".repeat(33), "acme_co"]) {
      expect((await admin("/identifier", "PUT", { identifier })).body.code).toBe(
        "sso.invalid_identifier",
      );
    }
    expect((await admin("/identifier", "PUT", { identifier: " ACME-1 " })).body.identifier).toBe(
      "acme-1",
    );
    const rival = await signedInAccount(worker, "boss@rival.com");
    addOrg(worker, OTHER_ORG, "enterprise", [[rival.id, "owner"]]);
    const taken = await admin(
      "/identifier",
      "PUT",
      { identifier: "acme-1" },
      OTHER_ORG,
      rival.token,
    );
    expect(taken).toMatchObject({ status: 409, body: { code: "sso.identifier_taken" } });
    expect(audit.calls).toContainEqual({
      method: "note",
      args: [owner.id, "org.sso_identifier_set", "acme-1", "203.0.113.1"],
    });
  });

  it("verifies a domain only with the exact TXT record, and for only one organization", async () => {
    const rival = await signedInAccount(worker, "boss@rival.com");
    addOrg(worker, OTHER_ORG, "enterprise", [[rival.id, "owner"]]);
    expect((await admin("/domains", "POST", { domain: "not a domain" })).status).toBe(400);
    const added = await admin("/domains", "POST", { domain: "Acme.COM" });
    const [domain] = added.body.domains as { domain: string; record: string; verified: boolean }[];
    expect(domain).toMatchObject({ domain: "acme.com", verified: false });
    expect(domain!.record).toMatch(/^7key-verify=[A-Za-z0-9_-]{32}$/);
    await admin("/domains", "POST", { domain: "acme.com" }, OTHER_ORG, rival.token);

    const missing = await admin("/domains/acme.com/verify", "POST");
    expect(missing.body.code).toBe("sso.domain_not_verified");
    idp.txt.set("acme.com", ["7key-verify=someone-elses-token"]);
    expect((await admin("/domains/acme.com/verify", "POST")).body.code).toBe(
      "sso.domain_not_verified",
    );
    idp.txt.set("acme.com", [domain!.record]);
    const verified = await admin("/domains/acme.com/verify", "POST");
    expect((verified.body.domains as { verified: boolean }[])[0]!.verified).toBe(true);

    const rivalRecord = (
      (await admin("", "GET", undefined, OTHER_ORG, rival.token)).body.domains as {
        record: string;
      }[]
    )[0]!.record;
    idp.txt.set("acme.com", [domain!.record, rivalRecord]);
    const stolen = await admin(
      "/domains/acme.com/verify",
      "POST",
      undefined,
      OTHER_ORG,
      rival.token,
    );
    expect(stolen).toMatchObject({ status: 409, body: { code: "sso.domain_taken" } });
    expect(
      (await admin("/domains", "POST", { domain: "acme.com" }, OTHER_ORG, rival.token)).status,
    ).toBe(201);
    expect(audit.calls.map((call) => call.args[1])).toEqual(
      expect.arrayContaining(["org.sso_domain_added", "org.sso_domain_verified"]),
    );
  });

  it("removes a domain and records it", async () => {
    await admin("/domains", "POST", { domain: "acme.com" });
    expect((await admin("/domains/acme.com", "DELETE")).body.domains).toEqual([]);
    expect((await admin("/domains/acme.com", "DELETE")).status).toBe(404);
  });
});

describe("provider configuration", () => {
  beforeEach(() => start());

  it("accepts only an https issuer whose discovery document matches", async () => {
    const base = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, enabled: true };
    for (const issuer of ["http://idp.example.test", "not a url", "https://u:p@idp.example.test"]) {
      expect((await admin("/provider", "PUT", { ...base, issuer })).body.code).toBe(
        "sso.invalid_provider",
      );
    }
    expect(
      (await admin("/provider", "PUT", { ...base, issuer: ISSUER, decryption: "trusted_devices" }))
        .body.code,
    ).toBe("sso.invalid_provider");
    idp.discovery.issuer = "https://evil.example";
    expect((await admin("/provider", "PUT", { ...base, issuer: ISSUER })).body.code).toBe(
      "sso.discovery_failed",
    );
  });

  it("seals the client secret and keeps it when the form leaves it blank", async () => {
    const saved = await admin("/provider", "PUT", {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      enabled: true,
    });
    expect(saved.body.provider).toEqual({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      hasSecret: true,
      enabled: true,
      decryption: "master_password",
    });
    const stored = worker.d1.db
      .prepare("SELECT client_secret FROM sso_configs WHERE org_id = ?")
      .get(ORG) as { client_secret: string };
    expect(stored.client_secret).toMatch(/^v2:/);
    expect(stored.client_secret).not.toContain(CLIENT_SECRET);
    await admin("/provider", "PUT", { issuer: ISSUER, clientId: CLIENT_ID, enabled: true });
    const again = worker.d1.db
      .prepare("SELECT client_secret FROM sso_configs WHERE org_id = ?")
      .get(ORG) as { client_secret: string };
    expect(again.client_secret).toBe(stored.client_secret);
  });
});

describe("OIDC sign-in", () => {
  let member: Awaited<ReturnType<typeof signedInAccount>>;

  beforeEach(async () => {
    await start();
    await configure();
    member = await signedInAccount(worker, "member@acme.com");
  });

  it("sends the browser to the provider with PKCE, state, nonce and a fixed redirect URI", async () => {
    const started = await prepared();
    const params = started.authorize.searchParams;
    expect(`${started.authorize.origin}${started.authorize.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(params)).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: "https://vault.test/api/sso/callback",
      scope: "openid email profile",
      code_challenge_method: "S256",
      login_hint: "member@acme.com",
    });
    expect(started.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.challenge).not.toBe(await s256(started.verifier));
    const byIdentifier = await begin({ identifier: "ACME" });
    expect(byIdentifier.response.body).toMatchObject({ orgName: "Acme", identifier: "acme" });
    expect((await begin({ email: "someone@elsewhere.com" })).response.body.code).toBe(
      "sso.not_found",
    );
    expect((await begin({})).response.body.code).toBe("sso.invalid_request");
  });

  it("signs an existing member in and returns what the client needs to unlock", async () => {
    const result = await signInThroughSso();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "signed_in",
      email: "member@acme.com",
      orgId: ORG,
      kdf: member.record.kdf,
      wrappedVaultKey: member.record.wrappedVaultKey,
    });
    const token = stringField(result.body, "token");
    expect((await worker.fetch("/api/orgs", { token })).status).toBe(200);
    const row = worker.d1.db
      .prepare("SELECT role FROM org_members WHERE org_id = ? AND account_id = ?")
      .get(ORG, member.id) as { role: string };
    expect(row.role).toBe("member");
    expect(audit.calls.some((call) => call.args[2] === "member.joined_sso")).toBe(true);
  });

  it("accepts an ES256 ID token", async () => {
    const started = await prepared();
    const { grant } = outcome(await callback(started, {}, { alg: "ES256" }));
    expect((await session(grant!, started.verifier)).status).toBe(200);
  });

  it("lets the IdP's sign-in stand in for 7key two-factor authentication", async () => {
    worker.d1.db.prepare("UPDATE accounts SET totp_enabled_at = ? WHERE id = ?").run(T0, member.id);
    const result = await signInThroughSso();
    expect(result.body.status).toBe("signed_in");
    expect(result.body.twoFactor).toBeUndefined();
  });

  it("uses each state once", async () => {
    const started = await prepared();
    expect(outcome(await callback(started)).grant).toBeTruthy();
    const replay = await callback(started);
    expect(replay.status).toBe(400);
    expect((await readJsonObject(replay)).code).toBe("sso.expired");
  });

  it("expires an unused state after ten minutes", async () => {
    const started = await prepared();
    worker.d1.db.prepare("UPDATE sso_states SET expires_at = ?").run(T0);
    expect((await callback(started)).status).toBe(400);
  });

  it("redeems a grant once, and only with the verifier of the client that started", async () => {
    const started = await prepared();
    const { grant } = outcome(await callback(started));
    expect((await session(grant!, toBase64Url(randomBytes(32)))).body.code).toBe("sso.expired");
    expect((await session(grant!, started.verifier)).body.code).toBe("sso.expired");

    const again = await prepared();
    const second = outcome(await callback(again)).grant!;
    expect((await session(second, again.verifier)).status).toBe(200);
    expect((await session(second, again.verifier)).status).toBe(403);
  });

  it("rejects ID tokens that fail any check", async () => {
    const other = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const cases: [Record<string, unknown>, Parameters<typeof callback>[2], string][] = [
      [{}, { key: other.privateKey }, "sso.failed"],
      [{}, { kid: "unknown" }, "sso.failed"],
      [{ aud: "someone-else" }, {}, "sso.failed"],
      [{ aud: [CLIENT_ID, "other"], azp: "other" }, {}, "sso.failed"],
      [{ iss: "https://evil.example" }, {}, "sso.failed"],
      [{ exp: T0 - 120 }, {}, "sso.failed"],
      [{ iat: undefined }, {}, "sso.failed"],
      [{ nonce: "replayed-nonce" }, {}, "sso.failed"],
      [{ email_verified: false }, {}, "sso.email_unverified"],
      [{ email_verified: "true" }, {}, "sso.email_unverified"],
      [{ email: "mallory@evil.com" }, {}, "sso.email_not_allowed"],
      [{ email: "member@sub.acme.com" }, {}, "sso.email_not_allowed"],
    ];
    for (const [overrides, options, code] of cases) {
      const started = await prepared();
      const result = outcome(await callback(started, overrides, options));
      expect(result, JSON.stringify(overrides)).toEqual({
        target: WEB_RETURN,
        grant: null,
        error: code,
      });
    }
  });

  it("rejects a code the provider refuses, such as one exchanged without the right verifier", async () => {
    const started = await prepared();
    idp.codes.set("tampered", { claims: claims(started), challenge: "not-the-challenge" });
    const response = await worker.fetch(`/api/sso/callback?code=tampered&state=${started.state}`);
    expect(outcome(response).error).toBe("sso.failed");
    const denied = await prepared();
    const cancelled = await worker.fetch(
      `/api/sso/callback?error=access_denied&state=${denied.state}`,
    );
    expect(outcome(cancelled).error).toBe("sso.failed");
  });

  it("only returns to the web app or a configured extension", async () => {
    const attempts = [
      "https://evil.example/app/",
      "https://vault.test/app/../evil",
      "https://vault.test/app/?next=https://evil.example",
      "https://vault.test.evil.example/app/",
      "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/",
      `chrome-extension://${OFFICIAL_EXTENSION_ID}/`,
      "javascript:alert(1)",
    ];
    for (const returnTo of attempts) {
      const { response } = await begin({ email: "member@acme.com", returnTo });
      expect(response.body.code, returnTo).toBe("sso.invalid_return");
    }
    const extension = await begin({
      email: "member@acme.com",
      returnTo: `https://${OFFICIAL_EXTENSION_ID}.chromiumapp.org/`,
    });
    expect(extension.response.status).toBe(200);
    const unknown = await worker.fetch("/api/sso/callback?code=x&state=forged-state-value");
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("Location")).toBeNull();
  });
});

describe("just-in-time provisioning", () => {
  beforeEach(async () => {
    await start();
    await configure();
  });

  async function registrationGrant(email: string, start: Record<string, unknown> = { email }) {
    const result = await signInThroughSso(email, {}, start);
    expect(result.body).toMatchObject({ status: "register", email, orgName: "Acme" });
    return stringField(result.body, "registrationGrant");
  }

  const register = (email: string, ssoGrant: string) =>
    worker
      .fetch("/api/auth/register", {
        method: "POST",
        json: { email, ...accountRecord(), ssoGrant },
      })
      .then(json);

  it("creates the account without a registration token and joins the organization", async () => {
    const grant = await registrationGrant("new@acme.com");
    const created = await register("new@acme.com", grant);
    expect(created.status).toBe(201);
    expect(created.body.orgId).toBe(ORG);
    const accountId = stringField(created.body, "accountId");
    const row = worker.d1.db
      .prepare("SELECT role FROM org_members WHERE org_id = ? AND account_id = ?")
      .get(ORG, accountId) as { role: string };
    expect(row.role).toBe("member");
    expect((await register("new@acme.com", grant)).body.code).toBe("sso.expired");
  });

  it("refuses a registration grant used for another address or without one", async () => {
    const grant = await registrationGrant("new@acme.com");
    expect((await register("other@acme.com", grant)).body.code).toBe("sso.expired");
    expect((await register("new@acme.com", grant)).body.code).toBe("sso.expired");
    expect((await register("new@acme.com", "forged-grant")).body.code).toBe("sso.expired");
  });

  it("admits an invited address that is not on a verified domain", async () => {
    worker.d1.db
      .prepare(
        `INSERT INTO org_invites (id, org_id, email, role, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, 'admin', ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), ORG, "guest@partner.org", owner.id, T0, T0 + 3600);
    const grant = await registrationGrant("guest@partner.org", { identifier: "acme" });
    const created = await register("guest@partner.org", grant);
    expect(created.body.orgId).toBe(ORG);
    const row = worker.d1.db
      .prepare("SELECT role FROM org_members WHERE org_id = ? AND account_id = ?")
      .get(ORG, stringField(created.body, "accountId")) as { role: string };
    expect(row.role).toBe("admin");

    const again = await signInThroughSso("guest@partner.org", {}, { identifier: "acme" });
    expect(again.body).toMatchObject({ status: "signed_in", orgId: ORG });
  });
});

describe("policies", () => {
  let member: Awaited<ReturnType<typeof signedInAccount>>;
  let admin2: Awaited<ReturnType<typeof signedInAccount>>;

  beforeEach(async () => {
    await start();
    await configure();
    member = await signedInAccount(worker, "member@acme.com");
    admin2 = await signedInAccount(worker, "admin@acme.com");
    worker.d1.db
      .prepare("INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .run(ORG, member.id, "member", T0);
    worker.d1.db
      .prepare("INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .run(ORG, admin2.id, "admin", T0);
  });

  const passwordLogin = (account: typeof member, email: string) =>
    worker
      .fetch("/api/auth/login", {
        method: "POST",
        json: { email, authKey: account.record.authKey },
      })
      .then(json);

  it("makes members sign in through SSO while owners and admins keep their password", async () => {
    expect((await admin("/policies", "PUT", { requireSso: true, singleOrg: false })).status).toBe(
      200,
    );
    const blocked = await passwordLogin(member, "member@acme.com");
    expect(blocked).toMatchObject({
      status: 403,
      body: { code: "auth.sso_required", params: { identifier: "acme" } },
    });
    expect((await passwordLogin(admin2, "admin@acme.com")).status).toBe(200);
    expect((await passwordLogin(owner, "owner@acme.com")).status).toBe(200);
    expect((await signInThroughSso("member@acme.com")).status).toBe(200);
  });

  it("stops enforcing Require SSO when the provider is switched off", async () => {
    await admin("/policies", "PUT", { requireSso: true, singleOrg: false });
    await admin("/provider", "PUT", { issuer: ISSUER, clientId: CLIENT_ID, enabled: false });
    expect((await passwordLogin(member, "member@acme.com")).status).toBe(200);
    expect(
      (await admin("/policies", "PUT", { requireSso: true, singleOrg: false })).body.code,
    ).toBe("sso.invalid_provider");
  });

  it("keeps members of a single-organization org from joining another", async () => {
    await admin("/policies", "PUT", { requireSso: false, singleOrg: true });
    const rival = await signedInAccount(worker, "boss@rival.com");
    addOrg(worker, OTHER_ORG, "free", [[rival.id, "owner"]]);
    const invite = (email: string) => {
      const id = crypto.randomUUID();
      worker.d1.db
        .prepare(
          `INSERT INTO org_invites (id, org_id, email, role, invited_by, created_at, expires_at)
           VALUES (?, ?, ?, 'member', ?, ?, ?)`,
        )
        .run(id, OTHER_ORG, email, rival.id, T0, T0 + 3600);
      return id;
    };
    const blocked = await worker
      .fetch(`/api/invites/${invite("member@acme.com")}/accept`, {
        method: "POST",
        token: member.token,
      })
      .then(json);
    expect(blocked).toMatchObject({ status: 403, body: { code: "orgs.single_org" } });
    const allowed = await worker
      .fetch(`/api/invites/${invite("admin@acme.com")}/accept`, {
        method: "POST",
        token: admin2.token,
      })
      .then(json);
    expect(allowed).toMatchObject({ status: 200, body: { orgId: OTHER_ORG } });
  });

  it("keeps people who belong to another organization out of a single-organization org", async () => {
    await admin("/policies", "PUT", { requireSso: false, singleOrg: true });
    const outsider = await signedInAccount(worker, "dev@acme.com");
    addOrg(worker, OTHER_ORG, "free", [[outsider.id, "owner"]]);
    const result = await signInThroughSso("dev@acme.com");
    expect(result).toMatchObject({ status: 403, body: { code: "orgs.single_org" } });
  });
});
