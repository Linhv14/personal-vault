import { describe, expect, it } from "vitest";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { REGISTRATION_TOKEN, startWorker, type TestWorker } from "./worker-harness.js";

const MALFORMED: [string, string | undefined][] = [
  ["not JSON", "{oops"],
  ["an array", "[1,2]"],
  ["null", "null"],
  ["a string", '"hello"'],
  ["a number", "42"],
  ["empty", undefined],
];

async function signUp(worker: TestWorker): Promise<string> {
  const response = await worker.fetch("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    json: {
      email: "owner@example.com",
      kdf: { type: "pbkdf2-sha256", iterations: 600_000, salt: toBase64(randomBytes(16)) },
      authKey: toBase64(randomBytes(32)),
      wrappedVaultKey: { ciphertext: toBase64(randomBytes(48)), nonce: toBase64(randomBytes(12)) },
    },
  });
  expect(response.status).toBe(201);
  const { token } = (await response.json()) as { token: string };
  return token;
}

async function send(
  worker: TestWorker,
  method: string,
  path: string,
  body: string | undefined,
  token?: string,
) {
  const response = await worker.fetch(path, {
    method,
    body,
    token,
    headers: { "Content-Type": "application/json", "x-registration-token": REGISTRATION_TOKEN },
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("malformed request bodies", () => {
  const anonymous: [string, string][] = [
    ["POST", "/api/auth/register"],
    ["POST", "/api/auth/prelogin"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/login/2fa"],
    ["POST", "/api/auth/recover/start"],
    ["POST", "/api/shares/abc/open"],
  ];

  for (const [method, path] of anonymous) {
    it.each(MALFORMED)(`${method} ${path} rejects a body that is %s`, async (_label, body) => {
      const worker = await startWorker();
      expect(await send(worker, method, path, body)).toEqual({
        status: 400,
        body: { code: "auth.invalid_body", error: "Request body is not valid JSON" },
      });
    });
  }

  const signedIn: [string, string][] = [
    ["PUT", "/api/account/recovery"],
    ["POST", "/api/account/2fa/setup"],
    ["POST", "/api/auth/change-password"],
    ["PUT", `/api/items/${crypto.randomUUID()}`],
    ["POST", "/api/items/batch"],
    ["POST", "/api/orgs"],
    ["PUT", "/api/auth/pin"],
    ["POST", "/api/shares"],
    ["POST", "/api/shares/status"],
  ];

  for (const [method, path] of signedIn) {
    it(`${method} ${path} rejects malformed bodies once signed in`, async () => {
      const worker = await startWorker();
      const token = await signUp(worker);
      for (const [label, body] of MALFORMED) {
        const result = await send(worker, method, path, body, token);
        expect(result, label).toMatchObject({ status: 400, body: { code: "auth.invalid_body" } });
      }
    });
  }

  it("still checks the session before the body", async () => {
    const worker = await startWorker();
    const result = await send(worker, "PUT", "/api/account/recovery", "{oops");
    expect(result.status).toBe(401);
  });

  it("keeps the field-level error for a well-formed object", async () => {
    const worker = await startWorker();
    expect(await send(worker, "POST", "/api/auth/prelogin", "{}")).toMatchObject({
      status: 400,
      body: { code: "auth.invalid_email" },
    });
    const token = await signUp(worker);
    const shares = JSON.stringify({ shares: [null, 1] });
    expect(await send(worker, "POST", "/api/shares/status", shares, token)).toEqual({
      status: 200,
      body: { shares: [] },
    });
  });

  it.each([
    ["a row longer than its columns", { a: { items: { columns: ["id"], rows: [[1, 2]] } } }],
    ["a cell that is not a value", { a: { items: { columns: ["id"], rows: [[true]] } } }],
    ["a column that is not a name", { a: { items: { columns: [1], rows: [] } } }],
    ["a dump that is a list", { a: [] }],
    ["users that are a list", []],
  ])("rejects a migration snapshot with %s", async (_label, users) => {
    const worker = await startWorker({ vars: { MIGRATION_TOKEN: "migrate" } });
    const response = await worker.fetch("/api/migration/import", {
      method: "POST",
      json: { users, orgs: {} },
      headers: { Authorization: "Bearer migrate" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "auth.invalid_body" });
  });
});
