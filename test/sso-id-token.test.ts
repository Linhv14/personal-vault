import { beforeAll, describe, expect, it } from "vitest";
import { FakeIdp } from "./sso-harness.js";

type Check = { ok: true; email: string; subject: string } | { ok: false; code: string };

const OIDC = new URL("../commercial/worker/sso/oidc.ts", import.meta.url).href;
const { verifyIdToken, jwksSource } = (await import(OIDC)) as {
  verifyIdToken(
    token: string,
    expected: { issuer: string; clientId: string; nonce: string; now: number; jwks: unknown },
  ): Promise<Check>;
  jwksSource(fetcher: FakeIdp["fetch"], uri: string): unknown;
};

const NOW = 1_800_000_000;
const ENTRA = "https://login.microsoftonline.com/0000-tenant/v2.0";
let idp: FakeIdp;

beforeAll(async () => {
  idp = await FakeIdp.create();
});

async function check(issuer: string, claims: Record<string, unknown>) {
  const token = await idp.sign({
    iss: issuer,
    aud: "client",
    sub: "user",
    email: "ana@acme.com",
    nonce: "n",
    iat: NOW,
    exp: NOW + 300,
    ...claims,
  });
  return verifyIdToken(token, {
    issuer,
    clientId: "client",
    nonce: "n",
    now: NOW,
    jwks: jwksSource(idp.fetch, "https://idp.example.test/jwks"),
  });
}

describe("verified email in ID tokens", () => {
  it("accepts Microsoft Entra ID's xms_edov in place of email_verified", async () => {
    expect(await check(ENTRA, { xms_edov: true })).toEqual({
      ok: true,
      email: "ana@acme.com",
      subject: "user",
    });
    expect(await check(ENTRA, { xms_edov: false })).toEqual({
      ok: false,
      code: "sso.email_unverified",
    });
  });

  it("ignores xms_edov from any other issuer", async () => {
    expect(await check("https://idp.example.test", { xms_edov: true })).toEqual({
      ok: false,
      code: "sso.email_unverified",
    });
  });
});
