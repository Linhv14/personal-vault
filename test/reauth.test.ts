import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromBase64, randomBytes, toBase64 } from "../src/core/bytes.js";
import {
  createAccount,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
  type AccountCryptoRecord,
} from "../src/core/crypto.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";

const changePassword = vi.fn(
  async (_auth: string, _record: AccountCryptoRecord, _options: unknown) => {},
);
vi.mock("../extension/lib/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extension/lib/api.js")>()),
  changePassword,
}));

const { currentAuthKey } = await import("../extension/lib/reauth.js");
const { upgradeKdf } = await import("../extension/lib/kdf-upgrade.js");

const EMAIL = "Alice@Example.com";
const PASSWORD = "correct horse battery staple";
const { record } = await createAccount(EMAIL, PASSWORD, 1_000);

function useLocal(state: Record<string, unknown>) {
  usePlatform({ local: memoryArea(state), session: memoryArea(), scheduleLock: async () => {} });
}

beforeEach(() => {
  changePassword.mockReset();
  useLocal({ email: EMAIL, kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
});

describe("currentAuthKey", () => {
  it("derives the auth key only for the right master password", async () => {
    expect(await currentAuthKey(PASSWORD)).toBe(record.authKey);
    expect(await currentAuthKey(`${PASSWORD} `)).toBeNull();
    expect(await currentAuthKey(PASSWORD.toUpperCase())).toBeNull();
    expect(await currentAuthKey("")).toBeNull();
  });

  it("returns nothing when the device has no account on it", async () => {
    useLocal({});
    expect(await currentAuthKey(PASSWORD)).toBeNull();
    useLocal({ email: EMAIL, kdf: record.kdf });
    expect(await currentAuthKey(PASSWORD)).toBeNull();
  });

  it("returns nothing for a damaged local key record instead of throwing", async () => {
    useLocal({
      email: EMAIL,
      kdf: record.kdf,
      wrappedVaultKey: { ...record.wrappedVaultKey, nonce: toBase64(randomBytes(12)) },
    });
    expect(await currentAuthKey(PASSWORD)).toBeNull();
    useLocal({ email: EMAIL, kdf: { ...record.kdf, type: "argon2id" }, wrappedVaultKey: {} });
    expect(await currentAuthKey(PASSWORD)).toBeNull();
  });
});

describe("upgradeKdf", () => {
  const vaultKeyRaw = randomBytes(32);

  it("rewraps the vault key at the default strength and keeps the session", async () => {
    const upgraded = await upgradeKdf(EMAIL, PASSWORD, vaultKeyRaw, record.authKey, "tok");
    expect(upgraded?.kdf.iterations).toBe(600_000);
    expect(upgraded?.kdf.salt).not.toBe(record.kdf.salt);
    expect(changePassword).toHaveBeenCalledTimes(1);
    const [auth, sent, options] = changePassword.mock.calls[0] ?? [];
    expect(auth).toBe(record.authKey);
    expect(options).toEqual({ keepSession: true, token: "tok" });
    expect(sent?.authKey).not.toBe(record.authKey);
    expect(sent?.wrappedVaultKey).toEqual(upgraded?.wrappedVaultKey);
    const master = await deriveMasterKey(EMAIL, PASSWORD, upgraded!.kdf);
    const opened = await openSealed(await deriveWrappingKey(master), upgraded!.wrappedVaultKey);
    expect(toBase64(opened)).toBe(toBase64(vaultKeyRaw));
    expect(fromBase64(sent!.authKey)).toHaveLength(32);
  });

  it("returns null and keeps the old record when the server refuses", async () => {
    changePassword.mockRejectedValueOnce(new Error("403"));
    expect(await upgradeKdf(EMAIL, PASSWORD, vaultKeyRaw, record.authKey, "tok")).toBeNull();
  });

  it("returns null for an empty password without calling the server", async () => {
    expect(await upgradeKdf(EMAIL, "", vaultKeyRaw, record.authKey, "tok")).toBeNull();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
