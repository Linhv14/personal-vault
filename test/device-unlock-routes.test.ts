import { beforeEach, describe, expect, it } from "vitest";
import { toBase64, toBase64Url, utf8Encode } from "../src/core/bytes.js";
import { readJsonObject, stringField } from "./helpers.js";
import {
  accountRecord,
  freezeClockAtT0,
  REGISTRATION_TOKEN,
  startWorker,
  type AccountRecord,
  type TestWorker,
} from "./worker-harness.js";

freezeClockAtT0();

const verifier = (byte: number) => toBase64(new Uint8Array(32).fill(byte));
const RP_ID = "abcdefghijklmnopabcdefghijklmnop";

let worker: TestWorker;

async function register(email: string, data: AccountRecord): Promise<string> {
  const response = await worker.fetch("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    json: { email, ...data },
  });
  expect(response.status).toBe(201);
  return stringField(await readJsonObject(response), "token");
}

async function login(email: string, data: AccountRecord): Promise<string> {
  const response = await worker.fetch("/api/auth/login", {
    method: "POST",
    json: { email, authKey: data.authKey },
  });
  expect(response.status).toBe(200);
  return stringField(await readJsonObject(response), "token");
}

const call = (path: string, token: string | undefined, method: string, json?: unknown) =>
  worker.fetch(`/api/auth${path}`, { method, token, json });

async function setPin(token: string, byte = 1): Promise<string> {
  const response = await call("/pin", token, "PUT", { verifier: verifier(byte) });
  expect(response.status).toBe(200);
  return stringField(await readJsonObject(response), "pinKey");
}

const unlockPin = (token: string, byte: number) =>
  call("/pin/unlock", token, "POST", { verifier: verifier(byte) });

let alice: AccountRecord;
let aliceToken: string;

beforeEach(async () => {
  worker = await startWorker();
  alice = accountRecord();
  aliceToken = await register("alice@example.com", alice);
});

describe("PIN unlock route", () => {
  it("returns the PIN key for the right verifier and never caches it", async () => {
    const pinKey = await setPin(aliceToken);
    const response = await unlockPin(aliceToken, 1);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(stringField(await readJsonObject(response), "pinKey")).toBe(pinKey);
  });

  it("counts down wrong tries and wipes the PIN on the fifth", async () => {
    await setPin(aliceToken);
    const answers: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await unlockPin(aliceToken, 9);
      answers.push([response.status, await readJsonObject(response)]);
    }
    expect(answers).toEqual([
      [403, expect.objectContaining({ code: "auth.pin_wrong", params: { count: 4 } })],
      [403, expect.objectContaining({ params: { count: 3 } })],
      [403, expect.objectContaining({ params: { count: 2 } })],
      [403, expect.objectContaining({ params: { count: 1 } })],
      [410, expect.objectContaining({ code: "auth.pin_off" })],
    ]);
    expect((await unlockPin(aliceToken, 1)).status).toBe(410);
  });

  it("resets the count after a right answer", async () => {
    await setPin(aliceToken);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await unlockPin(aliceToken, 9);
    }
    expect((await unlockPin(aliceToken, 1)).status).toBe(200);
    const next = await unlockPin(aliceToken, 9);
    expect(await readJsonObject(next)).toMatchObject({ params: { count: 4 } });
  });

  it("issues a new key and a fresh count when the PIN is set again", async () => {
    const first = await setPin(aliceToken, 1);
    await unlockPin(aliceToken, 9);
    const second = await setPin(aliceToken, 2);
    expect(second).not.toBe(first);
    expect((await unlockPin(aliceToken, 1)).status).toBe(403);
    const right = await unlockPin(aliceToken, 2);
    expect(stringField(await readJsonObject(right), "pinKey")).toBe(second);
  });

  it("keeps a PIN to the session that set it", async () => {
    await setPin(aliceToken);
    const laptop = await login("alice@example.com", alice);
    const bob = accountRecord();
    const bobToken = await register("bob@example.com", bob);
    expect((await unlockPin(laptop, 1)).status).toBe(410);
    expect((await unlockPin(bobToken, 1)).status).toBe(410);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await unlockPin(bobToken, 1);
    }
    expect((await unlockPin(aliceToken, 1)).status).toBe(200);
  });

  it("says the PIN is off when none was set or after it is cleared", async () => {
    expect((await unlockPin(aliceToken, 1)).status).toBe(410);
    await setPin(aliceToken);
    expect((await call("/pin", aliceToken, "DELETE")).status).toBe(200);
    expect((await unlockPin(aliceToken, 1)).status).toBe(410);
  });

  it("refuses malformed verifiers without counting them", async () => {
    await setPin(aliceToken);
    const bad = [
      {},
      { verifier: 7 },
      { verifier: "" },
      { verifier: toBase64(new Uint8Array(31)) },
      { verifier: toBase64(new Uint8Array(33)) },
      { verifier: "not base64 at all!!" },
    ];
    for (const body of bad) {
      expect((await call("/pin/unlock", aliceToken, "POST", body)).status).toBe(400);
      expect((await call("/pin", aliceToken, "PUT", body)).status).toBe(400);
    }
    const right = await unlockPin(aliceToken, 1);
    expect(right.status).toBe(200);
    const next = await unlockPin(aliceToken, 9);
    expect(await readJsonObject(next)).toMatchObject({ params: { count: 4 } });
  });

  it("needs a live session", async () => {
    await setPin(aliceToken);
    expect((await unlockPin("", 1)).status).toBe(401);
    expect((await unlockPin("forged-token", 1)).status).toBe(401);
    expect((await call("/pin", undefined, "PUT", { verifier: verifier(1) })).status).toBe(401);
    expect((await call("/pin", undefined, "DELETE")).status).toBe(401);
  });
});

describe("biometric unlock route", () => {
  const registration = {
    credentialId: toBase64Url(new Uint8Array(16).fill(4)),
    publicKey: toBase64Url(new Uint8Array(65).fill(5)),
    algorithm: -7,
    rpId: RP_ID,
    origin: `chrome-extension://${RP_ID}`,
  };

  const assertionFor = (challenge: string) => ({
    clientDataJSON: toBase64Url(
      utf8Encode(JSON.stringify({ type: "webauthn.get", challenge, origin: registration.origin })),
    ),
    authenticatorData: toBase64Url(new Uint8Array(37)),
    signature: toBase64Url(new Uint8Array(64).fill(1)),
  });

  async function challenge(token: string): Promise<string> {
    const response = await call("/biometric/challenge", token, "POST");
    expect(response.status).toBe(200);
    return stringField(await readJsonObject(response), "challenge");
  }

  it("is off until registered and refuses a mismatched origin", async () => {
    expect((await call("/biometric/challenge", aliceToken, "POST")).status).toBe(410);
    const wrongOrigin = { ...registration, origin: "https://evil.example" };
    expect((await call("/biometric", aliceToken, "PUT", wrongOrigin)).status).toBe(400);
    const wrongRp = { ...registration, rpId: "ponmlkjihgfedcbaponmlkjihgfedcba" };
    expect((await call("/biometric", aliceToken, "PUT", wrongRp)).status).toBe(400);
    expect((await call("/biometric", aliceToken, "PUT", registration)).status).toBe(200);
    expect((await call("/biometric/challenge", aliceToken, "POST")).status).toBe(200);
  });

  it("refuses a bad signature and does not let the challenge be reused", async () => {
    await call("/biometric", aliceToken, "PUT", registration);
    const issued = await challenge(aliceToken);
    const first = await call("/biometric/unlock", aliceToken, "POST", assertionFor(issued));
    expect(first.status).toBe(403);
    expect(await readJsonObject(first)).toMatchObject({ code: "auth.biometric_failed" });
    const replay = await call("/biometric/unlock", aliceToken, "POST", assertionFor(issued));
    expect(replay.status).toBe(403);
  });

  it("does not accept another session's challenge", async () => {
    await call("/biometric", aliceToken, "PUT", registration);
    const issued = await challenge(aliceToken);
    const laptop = await login("alice@example.com", alice);
    await call("/biometric", laptop, "PUT", registration);
    const stolen = await call("/biometric/unlock", laptop, "POST", assertionFor(issued));
    expect(stolen.status).toBe(403);
  });

  it("rejects malformed assertions with a 400", async () => {
    await call("/biometric", aliceToken, "PUT", registration);
    for (const body of [
      {},
      { ...assertionFor("x"), signature: 5 },
      { ...assertionFor("x"), clientDataJSON: "a".repeat(10_000) },
      { ...assertionFor("x"), authenticatorData: "%%%" },
    ]) {
      expect((await call("/biometric/unlock", aliceToken, "POST", body)).status).toBe(400);
    }
  });

  it("turns off and forgets the key", async () => {
    await call("/biometric", aliceToken, "PUT", registration);
    expect((await call("/biometric", aliceToken, "DELETE")).status).toBe(200);
    expect((await call("/biometric/challenge", aliceToken, "POST")).status).toBe(410);
  });
});
