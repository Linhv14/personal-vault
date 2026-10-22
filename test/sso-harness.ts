import { readFileSync } from "node:fs";
import { toBase64Url, utf8Encode } from "../src/core/bytes.js";
import { sha256 } from "../src/core/primitives.js";
import { signLicense } from "../commercial/scripts/issue-license.js";
import { readJsonObject, stringField } from "./helpers.js";
import { accountRecord, insertAccount, T0, type TestWorker } from "./worker-harness.js";

export const LICENSE_TEST_KEY = JSON.parse(
  readFileSync(new URL("./fixtures/license-test-key.json", import.meta.url), "utf8"),
) as { privateKeyPem: string; publicKey: string };

export const ISSUER = "https://idp.example.test";
export const CLIENT_ID = "7key-client";
export const CLIENT_SECRET = "s3cret value";

const encode = (value: unknown) => toBase64Url(utf8Encode(JSON.stringify(value)));

export async function s256(value: string): Promise<string> {
  return toBase64Url(await sha256(utf8Encode(value)));
}

interface PendingCode {
  claims: Record<string, unknown>;
  challenge: string;
  kid?: string;
  alg?: "RS256" | "ES256";
  key?: CryptoKey;
}

export class FakeIdp {
  readonly codes = new Map<string, PendingCode>();
  readonly requests: { url: string; body: string; authorization: string | null }[] = [];
  readonly txt = new Map<string, string[]>();
  rsa!: CryptoKeyPair;
  ec!: CryptoKeyPair;
  private jwks: Record<string, unknown>[] = [];
  discovery: Record<string, unknown> = {};

  static async create(): Promise<FakeIdp> {
    const idp = new FakeIdp();
    idp.rsa = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    idp.ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const rsa = await crypto.subtle.exportKey("jwk", idp.rsa.publicKey);
    const ec = await crypto.subtle.exportKey("jwk", idp.ec.publicKey);
    idp.jwks = [
      { kid: "rsa-1", kty: "RSA", n: rsa.n, e: rsa.e, alg: "RS256", use: "sig" },
      { kid: "ec-1", kty: "EC", crv: "P-256", x: ec.x, y: ec.y, alg: "ES256", use: "sig" },
    ];
    idp.discovery = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    };
    return idp;
  }

  async sign(
    claims: Record<string, unknown>,
    options: { kid?: string; alg?: "RS256" | "ES256"; key?: CryptoKey } = {},
  ): Promise<string> {
    const alg = options.alg ?? "RS256";
    const header = encode({ alg, kid: options.kid ?? (alg === "RS256" ? "rsa-1" : "ec-1") });
    const body = encode(claims);
    const key = options.key ?? (alg === "RS256" ? this.rsa.privateKey : this.ec.privateKey);
    const algorithm =
      alg === "RS256" ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash: "SHA-256" as const };
    const signature = await crypto.subtle.sign(algorithm, key, utf8Encode(`${header}.${body}`));
    return `${header}.${body}.${toBase64Url(new Uint8Array(signature))}`;
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const body = typeof init.body === "string" ? init.body : "";
    const authorization = new Headers(init.headers).get("Authorization");
    this.requests.push({ url: input, body, authorization });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.origin === "https://cloudflare-dns.com") {
      const name = url.searchParams.get("name") ?? "";
      const records = this.txt.get(name);
      return json(
        records
          ? {
              Status: 0,
              Answer: records.map((data) => ({ name, type: 16, TTL: 60, data: `"${data}"` })),
            }
          : { Status: 3 },
      );
    }
    if (input === `${ISSUER}/.well-known/openid-configuration`) {
      return json(this.discovery);
    }
    if (input === `${ISSUER}/jwks`) {
      return json({ keys: this.jwks });
    }
    if (input === `${ISSUER}/token` && init.method === "POST") {
      const form = new URLSearchParams(body);
      const pending = this.codes.get(form.get("code") ?? "");
      const expectedAuth = `Basic ${btoa(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`)}`;
      if (
        !pending ||
        authorization !== expectedAuth ||
        (await s256(form.get("code_verifier") ?? "")) !== pending.challenge
      ) {
        return json({ error: "invalid_grant" }, 400);
      }
      this.codes.delete(form.get("code") ?? "");
      return json({
        token_type: "Bearer",
        access_token: "at",
        id_token: await this.sign(pending.claims, pending),
      });
    }
    return new Response("not found", { status: 404 });
  };
}

export function fakeOrgStore() {
  const calls: { method: string; args: unknown[] }[] = [];
  const stub = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args });
        },
    },
  );
  return { calls, binding: { idFromName: (name: string) => name, get: () => stub } };
}

export function licenseFor(seats = 100, expiresAt = T0 + 86_400 * 365): string {
  return signLicense(LICENSE_TEST_KEY.privateKeyPem, {
    licensee: "Test Co",
    seats,
    expiresAt,
    features: ["sso"],
  });
}

export async function signedInAccount(worker: TestWorker, email: string) {
  const record = accountRecord();
  const id = await insertAccount(worker, email, record);
  const response = await worker.fetch("/api/auth/login", {
    method: "POST",
    json: { email, authKey: record.authKey },
  });
  const body = await readJsonObject(response);
  return { id, record, token: stringField(body, "token") };
}

export function addOrg(
  worker: TestWorker,
  orgId: string,
  plan: string,
  members: [string, "owner" | "admin" | "member"][],
): void {
  worker.d1.db
    .prepare("INSERT INTO orgs (id, name, plan, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(orgId, "Acme", plan, members[0]?.[0] ?? "nobody", T0);
  for (const [accountId, role] of members) {
    worker.d1.db
      .prepare("INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .run(orgId, accountId, role, T0);
  }
}
