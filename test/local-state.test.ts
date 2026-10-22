import { afterEach, describe, expect, it } from "vitest";
import { normalizeLocalState } from "../extension/lib/local-state.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getLocal, getUnlocked, loadPendingSignup } from "../extension/lib/storage.js";

const SEALED = { ciphertext: "AAAA", nonce: "BBBB" };

const VALID = {
  apiUrl: "https://vault.example",
  email: "me@example.com",
  kdf: { type: "pbkdf2-sha256", iterations: 600_000, salt: "c2FsdA==" },
  wrappedVaultKey: SEALED,
  items: [
    { id: "a", ciphertext: "x", nonce: "y", updatedAt: 1, deletedAt: null },
    { id: "b", ciphertext: null, nonce: null, updatedAt: 2, deletedAt: 3 },
  ],
  lastSync: 5,
  unboundItemsMigrated: true,
  aadBoundAccounts: ["tag"],
  autofillPromoDismissed: false,
  neverAskForms: ["example.com"],
  sharedLinks: SEALED,
  autoLockMinutes: 15,
  hasPasskeys: true,
  clockSkew: -2,
  locale: "vi",
  showLogos: false,
  resume: { token: "t", sealed: SEALED },
  pin: { token: "t", salt: "s", iterations: 100_000, sealed: SEALED },
  biometric: { token: "t", credentialId: "c", secret: "s", sealed: SEALED },
  biometricPromoDismissed: true,
  identity: { publicKey: "pk", wrappedPrivateKey: SEALED },
  sharedVaults: [
    {
      orgId: "o",
      orgName: "Acme",
      teamId: "t",
      name: "Ops",
      generation: 2,
      rekeyNeeded: false,
      viewOnly: true,
      wrappedKey: { ephemeralPublicKey: "e", sealed: SEALED },
      items: [{ id: "i", sealed: SEALED, updatedAt: 1, updatedBy: "u" }],
    },
  ],
  sharedGenerations: { t: 2 },
};

afterEach(() =>
  usePlatform({ local: memoryArea(), session: memoryArea(), scheduleLock: async () => {} }),
);

describe("local state normalisation", () => {
  it("keeps every field the extension writes", () => {
    expect(normalizeLocalState(VALID)).toEqual(VALID);
    expect(normalizeLocalState({ autoLockMinutes: -1 })).toEqual({ autoLockMinutes: -1 });
    expect(normalizeLocalState({ locale: "auto", apiUrl: "http://127.0.0.1:8787" })).toEqual({
      locale: "auto",
      apiUrl: "http://127.0.0.1:8787",
    });
  });

  it.each([
    ["apiUrl", "vault.example"],
    ["apiUrl", "javascript:alert(1)"],
    ["email", 42],
    ["kdf", { type: "argon2", iterations: 3, salt: "x" }],
    ["kdf", { type: "pbkdf2-sha256", iterations: "600000", salt: "x" }],
    ["wrappedVaultKey", { ciphertext: "x" }],
    ["autoLockMinutes", "15"],
    ["autoLockMinutes", -5],
    ["autoLockMinutes", 1.5],
    ["locale", "fr"],
    ["pin", { token: "t", salt: "s", iterations: 0, sealed: SEALED }],
    ["biometric", { token: "t", credentialId: "c", sealed: SEALED }],
    ["resume", { token: 1, sealed: SEALED }],
    ["identity", { publicKey: "pk" }],
    ["neverAskForms", ["a", 1]],
    ["sharedGenerations", { t: "2" }],
    ["sharedVaults", [{ ...VALID.sharedVaults[0], wrappedKey: SEALED }]],
  ])("drops a malformed %s and keeps the rest", (key, value) => {
    const state = normalizeLocalState({ ...VALID, [key]: value });
    expect(state).not.toHaveProperty(key);
    expect(state.email ?? state.apiUrl).toBeDefined();
  });

  it("forgets the sync point when the item cache is malformed, forcing a full sync", () => {
    const state = normalizeLocalState({ ...VALID, items: [{ id: "a" }] });
    expect(state).not.toHaveProperty("items");
    expect(state).not.toHaveProperty("lastSync");
  });

  it("is what getLocal returns", async () => {
    usePlatform({
      local: memoryArea({ apiUrl: 7, email: "me@example.com", stray: true }),
      session: memoryArea(),
      scheduleLock: async () => {},
    });
    expect(await getLocal()).toEqual({ email: "me@example.com" });
  });
});

describe("session state", () => {
  it("ignores a malformed vault key and a malformed pending signup", async () => {
    usePlatform({
      local: memoryArea(),
      session: memoryArea({
        vaultKeyRaw: 1,
        pendingSignup: { apiUrl: "https://vault.example", email: "me@example.com" },
      }),
      scheduleLock: async () => {},
    });
    expect(await getUnlocked()).toBeNull();
    expect(await loadPendingSignup()).toBeNull();
  });
});
