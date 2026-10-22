import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryCreatedAt, requestRecoveryEmail } from "../extension/lib/account-recovery.js";
import {
  ApiError,
  listSessions,
  login,
  loginSecondFactor,
  prelogin,
  resumeKey,
} from "../extension/lib/api.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { generateRecoveryCode } from "../src/core/recovery.js";

const SEALED = { ciphertext: "AAAA", nonce: "BBBB" };
const KDF = { type: "pbkdf2-sha256", iterations: 600_000, salt: "c2FsdA==" };
const SESSION = {
  id: "s1",
  label: "Chrome on macOS",
  kind: "browser",
  createdAt: 1,
  lastSeenAt: null,
  current: true,
};

function reply(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

async function messageKeyOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) {
      return error.messageKey;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  usePlatform({
    local: memoryArea({ apiUrl: "https://vault.test" }),
    session: memoryArea({ token: "session", vaultKeyRaw: "a2V5" }),
    scheduleLock: async () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("security-relevant API responses", () => {
  it("passes through well-formed sign-in replies", async () => {
    reply({ token: "t", expiresAt: 9, wrappedVaultKey: SEALED, upgradeKdf: true });
    expect(await login("me@example.com", "key")).toEqual({
      token: "t",
      expiresAt: 9,
      wrappedVaultKey: SEALED,
      upgradeKdf: true,
    });
    reply({ twoFactor: "required", challenge: "c", expiresAt: 9 });
    expect(await login("me@example.com", "key")).toEqual({
      twoFactor: "required",
      challenge: "c",
      expiresAt: 9,
    });
    reply({ kdf: KDF });
    expect(await prelogin("me@example.com")).toEqual(KDF);
    reply({ sessions: [SESSION, { ...SESSION, id: "s2", kind: "tablet", current: false }] });
    expect(await listSessions()).toEqual([
      SESSION,
      { ...SESSION, id: "s2", kind: "unknown", current: false },
    ]);
  });

  it.each([
    ["a list", []],
    ["null", null],
    [
      "a sealed key with no nonce",
      { token: "t", expiresAt: 9, wrappedVaultKey: { ciphertext: "x" } },
    ],
    ["no expiry", { token: "t", wrappedVaultKey: SEALED }],
    [
      "a mistyped upgrade flag",
      { token: "t", expiresAt: 9, wrappedVaultKey: SEALED, upgradeKdf: 1 },
    ],
    ["a challenge that is not text", { twoFactor: "required", challenge: 1, expiresAt: 9 }],
  ])("rejects a login reply that is %s", async (_label, body) => {
    reply(body);
    expect(await messageKeyOf(login("me@example.com", "key"))).toBe("error.api.bad_response");
  });

  it("keeps asking for an update when the reply lacks a token", async () => {
    reply({ wrappedVaultKey: SEALED });
    expect(await messageKeyOf(login("me@example.com", "key"))).toBe("error.auth.client_outdated");
  });

  it("rejects a malformed second-factor reply", async () => {
    reply({ token: 5, expiresAt: 9, wrappedVaultKey: SEALED });
    expect(await messageKeyOf(loginSecondFactor("c", "123456"))).toBe("error.auth.client_outdated");
    reply({ token: "t", expiresAt: "soon", wrappedVaultKey: SEALED });
    expect(await messageKeyOf(loginSecondFactor("c", "123456"))).toBe("error.api.bad_response");
  });

  it.each([
    ["prelogin", () => prelogin("me@example.com"), { kdf: { ...KDF, iterations: "600000" } }],
    ["prelogin", () => prelogin("me@example.com"), {}],
    ["resume key", () => resumeKey("t"), { resumeKey: 1 }],
    ["sessions", () => listSessions(), { sessions: [{ ...SESSION, current: "yes" }] }],
    ["sessions", () => listSessions(), { sessions: {} }],
    ["recovery status", () => recoveryCreatedAt(), { createdAt: "today" }],
    [
      "recovery email",
      () => requestRecoveryEmail("me@example.com", generateRecoveryCode(), "en"),
      { required: "yes" },
    ],
  ])("rejects a malformed %s reply", async (_label, call, body) => {
    reply(body);
    expect(await messageKeyOf(call())).toBe("error.api.bad_response");
  });

  it("accepts a recovery status of never", async () => {
    reply({ createdAt: null });
    expect(await recoveryCreatedAt()).toBeNull();
  });
});
