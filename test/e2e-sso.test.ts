import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes, toBase64, toBase64Url, utf8Encode } from "../src/core/bytes.js";
import { createAccount, deriveAuthKey, deriveMasterKey } from "../src/core/crypto.js";
import { sha256 } from "../src/core/primitives.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const ISSUER = process.env.VAULT_SSO_TEST_ISSUER ?? "https://idp.test.invalid";
const CLIENT_ID = "e2e-client";
const enabled = process.env.VAULT_E2E === "1";
const testKey = JSON.parse(
  readFileSync(new URL("./fixtures/ci-test-key.json", import.meta.url), "utf8"),
) as JsonWebKey & { kid: string };

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  return {
    status: response.status,
    location: response.headers.get("Location"),
    body: text && text.startsWith("{") ? JSON.parse(text) : null,
  };
}

const json = (body: unknown) => JSON.stringify(body);
const unique = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    testKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => toBase64Url(utf8Encode(JSON.stringify(value)));
  const header = encode({ alg: "RS256", kid: testKey.kid, typ: "JWT" });
  const payload = encode({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 300, ...claims });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8Encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function register(email: string, password: string) {
  const { record } = await createAccount(email, password, 600_000);
  const registered = await api("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    body: json({ email, ...record }),
  });
  return { token: registered.body.token as string, record };
}

async function startSso(lookup: Record<string, string>, returnTo = `${BASE}/app/`) {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(await sha256(utf8Encode(verifier)));
  const prepared = await api("/api/sso/prepare", {
    method: "POST",
    body: json({ ...lookup, returnTo, clientChallenge: challenge }),
  });
  return { prepared, verifier };
}

async function signInWithSso(email: string, identifier: string, overrides = {}) {
  const { prepared, verifier } = await startSso({ identifier });
  expect(prepared.status).toBe(200);
  const authorize = new URL(prepared.body.authorizeUrl);
  const code = await idToken({
    sub: `sub-${email}`,
    email,
    email_verified: true,
    nonce: authorize.searchParams.get("nonce"),
    ...overrides,
  });
  const query = new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" });
  const callback = await api(`/api/sso/callback?${query.toString()}`);
  expect(callback.status).toBe(302);
  const params = new URLSearchParams(new URL(callback.location!).hash.slice(1));
  return { params, verifier, authorize };
}

describe.skipIf(!enabled)("single sign-on with a local test identity provider", () => {
  const identifier = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const memberEmail = unique("sso-member");
  let ownerToken: string;
  let orgId: string;

  beforeAll(async () => {
    ownerToken = (await register(unique("sso-owner"), "owner password for sso")).token;
    orgId = (
      await api("/api/orgs", { method: "POST", token: ownerToken, body: json({ name: "SSO Inc" }) })
    ).body.id;
  });

  it("reports the licence and configures the organization", async () => {
    const overview = await api(`/api/orgs/${orgId}/sso`, { token: ownerToken });
    expect(overview.body).toMatchObject({
      available: true,
      license: { status: "valid" },
      redirectUri: `${BASE}/api/sso/callback`,
    });
    const named = await api(`/api/orgs/${orgId}/sso/identifier`, {
      method: "PUT",
      token: ownerToken,
      body: json({ identifier }),
    });
    expect(named.body.identifier).toBe(identifier);
    const provider = await api(`/api/orgs/${orgId}/sso/provider`, {
      method: "PUT",
      token: ownerToken,
      body: json({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "e2e-secret",
        enabled: true,
      }),
    });
    expect(provider.status).toBe(200);
    expect(provider.body.provider).toMatchObject({ issuer: ISSUER, hasSecret: true });
    const invited = await api(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      token: ownerToken,
      body: json({ email: memberEmail, role: "member" }),
    });
    expect(invited.status).toBe(201);
  });

  it("refuses return addresses outside the allow-list", async () => {
    const { prepared } = await startSso({ identifier }, "https://evil.example/app/");
    expect(prepared.body.code).toBe("sso.invalid_return");
  });

  it("rejects an ID token for another client", async () => {
    const { params } = await signInWithSso(memberEmail, identifier, { aud: "someone-else" });
    expect(params.get("sso_error")).toBe("sso.failed");
  });

  it("provisions an invited newcomer just in time, once", async () => {
    const { params, verifier } = await signInWithSso(memberEmail, identifier);
    const grant = params.get("sso_grant")!;
    const session = await api("/api/sso/session", {
      method: "POST",
      body: json({ grant, clientVerifier: verifier }),
    });
    expect(session.body).toMatchObject({ status: "register", email: memberEmail });
    const replay = await api("/api/sso/session", {
      method: "POST",
      body: json({ grant, clientVerifier: verifier }),
    });
    expect(replay.status).toBe(403);

    const { record } = await createAccount(memberEmail, "member password for sso", 600_000);
    const created = await api("/api/auth/register", {
      method: "POST",
      body: json({ email: memberEmail, ...record, ssoGrant: session.body.registrationGrant }),
    });
    expect(created.status).toBe(201);
    expect(created.body.orgId).toBe(orgId);
  });

  it("signs the member in again through SSO and enforces Require SSO", async () => {
    const policies = await api(`/api/orgs/${orgId}/sso/policies`, {
      method: "PUT",
      token: ownerToken,
      body: json({ requireSso: true, singleOrg: true }),
    });
    expect(policies.body.policies).toEqual({ requireSso: true, singleOrg: true });

    const prelogin = await api("/api/auth/prelogin", {
      method: "POST",
      body: json({ email: memberEmail }),
    });
    const masterKey = await deriveMasterKey(
      memberEmail,
      "member password for sso",
      prelogin.body.kdf,
    );
    const login = await api("/api/auth/login", {
      method: "POST",
      body: json({ email: memberEmail, authKey: toBase64(await deriveAuthKey(masterKey)) }),
    });
    expect(login).toMatchObject({
      status: 403,
      body: { code: "auth.sso_required", params: { identifier } },
    });

    const { params, verifier } = await signInWithSso(memberEmail, identifier);
    const session = await api("/api/sso/session", {
      method: "POST",
      body: json({ grant: params.get("sso_grant"), clientVerifier: verifier }),
    });
    expect(session.body).toMatchObject({ status: "signed_in", email: memberEmail, orgId });
    expect(session.body.kdf).toEqual(prelogin.body.kdf);
    const orgs = await api("/api/orgs", { token: session.body.token });
    expect(orgs.body.orgs.map((org: { id: string }) => org.id)).toEqual([orgId]);
  });
});
