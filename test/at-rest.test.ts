import { describe, expect, it } from "vitest";
import {
  protectAuthKey,
  protectWrappedKey,
  revealWrappedKey,
  verifyAuthKey,
} from "../src/worker/at-rest.js";
import { hashAuthKey } from "../src/core/crypto.js";
import { randomBytes, toBase64 } from "../src/core/bytes.js";

const env = { AT_REST_SECRET: "test-at-rest-secret" };
const otherEnv = { AT_REST_SECRET: "a-different-secret" };
const authKey = toBase64(randomBytes(32));
const clientCiphertext = toBase64(randomBytes(48));

describe("auth key hash at rest", () => {
  it("cannot be reproduced without the Worker secret", async () => {
    const stored = await protectAuthKey(env, authKey);
    expect(stored).not.toBe(await hashAuthKey(authKey));
    expect(stored).not.toBe(await protectAuthKey(otherEnv, authKey));
    expect(await verifyAuthKey(env, authKey, stored)).toEqual({
      matches: true,
      needsUpgrade: false,
    });
    expect((await verifyAuthKey(otherEnv, authKey, stored)).matches).toBe(false);
  });

  it("rejects a different auth key", async () => {
    const stored = await protectAuthKey(env, authKey);
    const wrong = toBase64(randomBytes(32));
    expect((await verifyAuthKey(env, wrong, stored)).matches).toBe(false);
  });

  it("accepts a legacy SHA-256 hash only when the caller opts in, and flags it for upgrade", async () => {
    const legacy = await hashAuthKey(authKey);
    expect(await verifyAuthKey(env, authKey, legacy, { acceptLegacy: true })).toEqual({
      matches: true,
      needsUpgrade: true,
    });
    expect(await verifyAuthKey(env, authKey, legacy)).toEqual({
      matches: false,
      needsUpgrade: false,
    });
  });
});

describe("wrapped vault key at rest", () => {
  it("round-trips and never stores the client ciphertext as-is", async () => {
    const stored = await protectWrappedKey(env, "account-1", clientCiphertext);
    expect(stored).not.toContain(clientCiphertext);
    expect(await revealWrappedKey(env, "account-1", stored)).toEqual({
      ciphertext: clientCiphertext,
      needsUpgrade: false,
    });
  });

  it("is bound to its account, so rows cannot be swapped", async () => {
    const stored = await protectWrappedKey(env, "account-1", clientCiphertext);
    await expect(revealWrappedKey(env, "account-2", stored)).rejects.toThrow();
  });

  it("cannot be opened with another secret", async () => {
    const stored = await protectWrappedKey(env, "account-1", clientCiphertext);
    await expect(revealWrappedKey(otherEnv, "account-1", stored)).rejects.toThrow();
  });

  it("passes a legacy row through and flags it for upgrade", async () => {
    expect(await revealWrappedKey(env, "account-1", clientCiphertext)).toEqual({
      ciphertext: clientCiphertext,
      needsUpgrade: true,
    });
  });
});
