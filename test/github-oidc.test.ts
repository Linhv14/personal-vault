import { beforeAll, describe, expect, it } from "vitest";
import { toBase64Url, utf8Encode } from "../src/core/bytes.js";
import { GITHUB_ISSUER, verifyGithubToken, type Jwk } from "../src/worker/github-oidc.js";

const AUDIENCE = "https://7key.online";
const NOW = 1_800_000_000;
let pair: CryptoKeyPair;
let jwk: Jwk;

async function sign(payload: Record<string, unknown>, kid = "key-1", key = pair.privateKey) {
  const header = toBase64Url(utf8Encode(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })));
  const body = toBase64Url(utf8Encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    utf8Encode(`${header}.${body}`),
  );
  return `${header}.${body}.${toBase64Url(new Uint8Array(signature))}`;
}

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: GITHUB_ISSUER,
  aud: AUDIENCE,
  exp: NOW + 300,
  nbf: NOW - 10,
  repository: "acme/api",
  ref: "refs/heads/main",
  event_name: "push",
  environment: "production",
  ...overrides,
});

const verify = (token: string) =>
  verifyGithubToken(token, { audience: AUDIENCE, now: NOW, jwks: async () => [jwk] });

beforeAll(async () => {
  pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  jwk = { kid: "key-1", kty: "RSA", n: exported.n!, e: exported.e! };
});

describe("GitHub Actions OIDC tokens", () => {
  it("accepts a token signed by a published key for this audience", async () => {
    expect(await verify(await sign(claims()))).toEqual({
      repository: "acme/api",
      ref: "refs/heads/main",
      event_name: "push",
      environment: "production",
    });
  });

  it("rejects the wrong audience, issuer, an expired token or an unknown key", async () => {
    expect(await verify(await sign(claims({ aud: "https://elsewhere.example" })))).toBeNull();
    expect(await verify(await sign(claims({ iss: "https://evil.example" })))).toBeNull();
    expect(await verify(await sign(claims({ exp: NOW - 120 })))).toBeNull();
    expect(await verify(await sign(claims(), "other-key"))).toBeNull();
  });

  it("accepts any of the server's own addresses as the audience, and nothing else", async () => {
    const both = (token: string) =>
      verifyGithubToken(token, {
        audience: [AUDIENCE, "https://old.example"],
        now: NOW,
        jwks: async () => [jwk],
      });
    expect(await both(await sign(claims({ aud: "https://old.example" })))).not.toBeNull();
    expect(await both(await sign(claims({ aud: ["x", AUDIENCE] })))).not.toBeNull();
    expect(await both(await sign(claims({ aud: "https://elsewhere.example" })))).toBeNull();
  });

  it("rejects a token whose payload was changed after signing", async () => {
    const [header, , signature] = (await sign(claims())).split(".");
    const forged = toBase64Url(utf8Encode(JSON.stringify(claims({ repository: "evil/api" }))));
    expect(await verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed by a different key with the same id", async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    expect(await verify(await sign(claims(), "key-1", other.privateKey))).toBeNull();
  });
});
