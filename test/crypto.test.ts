import { describe, expect, it } from "vitest";
import {
  DEFAULT_KDF_ITERATIONS,
  createAccount,
  createVaultKey,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  hashAuthKey,
  importVaultKey,
  open,
  openJson,
  rewrapVaultKey,
  seal,
  sealJson,
  unlockVault,
  type KdfParams,
} from "../src/core/crypto.js";
import { fromBase64, toBase64, utf8Decode, utf8Encode } from "../src/core/bytes.js";
import { expectCodeAsync } from "./helpers.js";

const TEST_KDF_ITERATIONS = 1_000;
const EMAIL = "you@example.com";
const PASSWORD = "a long and hard to guess master password";

const KDF: KdfParams = {
  type: "pbkdf2-sha256",
  iterations: TEST_KDF_ITERATIONS,
  salt: toBase64(new Uint8Array(16)),
};

describe("deriveMasterKey", () => {
  it("returns 32 bytes and is deterministic", async () => {
    const a = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    const b = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
  });

  it("normalizes the email so case and whitespace do not change the key", async () => {
    const a = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    const b = await deriveMasterKey("  YOU@Example.COM  ", PASSWORD, KDF);
    expect(a).toEqual(b);
  });

  it("changes with the email, password, salt or iteration count", async () => {
    const base = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveMasterKey("other@x.com", PASSWORD, KDF)).not.toEqual(base);
    expect(await deriveMasterKey(EMAIL, PASSWORD + "x", KDF)).not.toEqual(base);
    expect(
      await deriveMasterKey(EMAIL, PASSWORD, { ...KDF, salt: toBase64(new Uint8Array([1])) }),
    ).not.toEqual(base);
    expect(
      await deriveMasterKey(EMAIL, PASSWORD, { ...KDF, iterations: TEST_KDF_ITERATIONS + 1 }),
    ).not.toEqual(base);
  });

  it("rejects an empty password and an unknown KDF", async () => {
    await expectCodeAsync(deriveMasterKey(EMAIL, "", KDF), "crypto.empty_password");
    await expectCodeAsync(
      deriveMasterKey(EMAIL, PASSWORD, { ...KDF, type: "argon2id" as never }),
      "crypto.unsupported_kdf",
    );
  });

  it("defaults to 600,000 iterations", () => {
    expect(DEFAULT_KDF_ITERATIONS).toBe(600_000);
  });
});

describe("auth key and encryption key separation", () => {
  it("auth key differs from the master key", async () => {
    const masterKey = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveAuthKey(masterKey)).not.toEqual(masterKey);
  });

  it("auth key is deterministic", async () => {
    const masterKey = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveAuthKey(masterKey)).toEqual(await deriveAuthKey(masterKey));
  });

  it("a wrapping key cannot open data sealed under a different master key", async () => {
    const k1 = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD, KDF));
    const k2 = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD + "x", KDF));
    const sealed = await seal(k1, utf8Encode("secret"));
    await expect(open(k2, sealed)).rejects.toThrow();
  });

  it("the wrapping key cannot be exported from JavaScript", async () => {
    const key = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD, KDF));
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

describe("seal / open", () => {
  it("round-trips content including non-ASCII text", async () => {
    const key = await importVaultKey(createVaultKey());
    const plaintext = "Password: Trời ơi #2026 — ốc, ưởng, ễ";
    const sealed = await seal(key, utf8Encode(plaintext));
    expect(utf8Decode(await open(key, sealed))).toBe(plaintext);
  });

  it("uses a fresh nonce, so identical plaintext yields different ciphertext", async () => {
    const key = await importVaultKey(createVaultKey());
    const a = await seal(key, utf8Encode("x"));
    const b = await seal(key, utf8Encode("x"));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("uses the recommended 12-byte nonce", async () => {
    const key = await importVaultKey(createVaultKey());
    expect(fromBase64((await seal(key, utf8Encode("x"))).nonce)).toHaveLength(12);
  });

  it("detects a single flipped bit in the ciphertext", async () => {
    const key = await importVaultKey(createVaultKey());
    const sealed = await seal(key, utf8Encode("balance: 100"));
    const bytes = fromBase64(sealed.ciphertext);
    bytes[0]! ^= 0x01;
    await expect(open(key, { ...sealed, ciphertext: toBase64(bytes) })).rejects.toThrow();
  });

  it("detects a modified nonce", async () => {
    const key = await importVaultKey(createVaultKey());
    const sealed = await seal(key, utf8Encode("x"));
    const nonce = fromBase64(sealed.nonce);
    nonce[0]! ^= 0x01;
    await expect(open(key, { ...sealed, nonce: toBase64(nonce) })).rejects.toThrow();
  });

  it("round-trips nested objects through sealJson/openJson", async () => {
    const key = await importVaultKey(createVaultKey());
    const item = {
      title: "Bank",
      username: "me@x.com",
      password: "p@ss",
      totp: { secret: "JBSWY3DPEHPK3PXP", digits: 6 },
      tags: ["finance", "important"],
    };
    expect(await openJson(key, await sealJson(key, item))).toEqual(item);
  });

  it("rejects a vault key of the wrong length", async () => {
    await expectCodeAsync(importVaultKey(new Uint8Array(16)), "crypto.bad_key_length");
  });
});

describe("createAccount / unlockVault", () => {
  it("reopens the vault with the correct master password", async () => {
    const { record, vaultKey } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const sealed = await sealJson(vaultKey, { secret: "hello" });

    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    expect(await openJson(unlocked.vaultKey, sealed)).toEqual({ secret: "hello" });
  });

  it("reports a wrong master password distinctly", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    await expectCodeAsync(unlockVault(EMAIL, "wrong", record), "crypto.wrong_password");
  });

  it("returns the same auth key that registration produced", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    expect(unlocked.authKey).toBe(record.authKey);
  });

  it("gives each account its own salt, so one password yields different auth keys", async () => {
    const a = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const b = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    expect(a.record.kdf.salt).not.toBe(b.record.kdf.salt);
    expect(a.record.authKey).not.toBe(b.record.authKey);
  });
});

describe("rewrapVaultKey", () => {
  it("keeps items readable after a master password change", async () => {
    const { record, vaultKey } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const sealed = await sealJson(vaultKey, { note: "written before the change" });

    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    const newRecord = await rewrapVaultKey(
      EMAIL,
      "a different master password",
      unlocked.vaultKeyRaw,
      TEST_KDF_ITERATIONS,
    );

    const reopened = await unlockVault(EMAIL, "a different master password", newRecord);
    expect(await openJson(reopened.vaultKey, sealed)).toEqual({
      note: "written before the change",
    });
    expect(reopened.vaultKeyRaw).toEqual(unlocked.vaultKeyRaw);
  });

  it("stops the old password from opening the new record", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    const newRecord = await rewrapVaultKey(
      EMAIL,
      "new password",
      unlocked.vaultKeyRaw,
      TEST_KDF_ITERATIONS,
    );
    await expectCodeAsync(unlockVault(EMAIL, PASSWORD, newRecord), "crypto.wrong_password");
  });
});

describe("hashAuthKey", () => {
  it("is deterministic, 32 bytes, and not the auth key itself", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, TEST_KDF_ITERATIONS);
    const hash = await hashAuthKey(record.authKey);
    expect(await hashAuthKey(record.authKey)).toBe(hash);
    expect(fromBase64(hash)).toHaveLength(32);
    expect(hash).not.toBe(record.authKey);
  });
});

describe("associated data", () => {
  it("only opens with the exact associated data it was sealed with", async () => {
    const key = await importVaultKey(createVaultKey());
    const sealed = await sealJson(key, { title: "bank" }, utf8Encode("item-a"));

    expect(await openJson(key, sealed, utf8Encode("item-a"))).toEqual({ title: "bank" });
    await expect(openJson(key, sealed, utf8Encode("item-b"))).rejects.toThrow();
    await expect(openJson(key, sealed)).rejects.toThrow();
  });
});
