import { describe, expect, it } from "vitest";
import { randomBytes, utf8Encode, type Bytes } from "../src/core/bytes.js";
import { hkdfAesKey, pbkdf2AesKey, pbkdf2Bits, sha1, sha256 } from "../src/core/primitives.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function roundTrip(encryptWith: CryptoKey, decryptWith: CryptoKey): Promise<string> {
  const iv = randomBytes(12);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptWith,
    utf8Encode("hi"),
  );
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, decryptWith, sealed);
  return new TextDecoder().decode(opened);
}

describe("crypto primitives", () => {
  it("matches the RFC 7914 PBKDF2-HMAC-SHA256 vector", async () => {
    const bits = await pbkdf2Bits(utf8Encode("passwd"), utf8Encode("salt"), 1, 512);
    expect(hex(bits)).toBe(
      "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783",
    );
  });

  it("hashes the standard abc vectors", async () => {
    expect(hex(await sha1(utf8Encode("abc")))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hex(await sha256(utf8Encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("derives the same non-extractable AES key from the same passphrase only", async () => {
    const salt = randomBytes(16);
    const key = await pbkdf2AesKey(utf8Encode("correct horse"), salt, 1000);
    expect(key.extractable).toBe(false);
    expect(await roundTrip(key, await pbkdf2AesKey(utf8Encode("correct horse"), salt, 1000))).toBe(
      "hi",
    );
    await expect(
      roundTrip(key, await pbkdf2AesKey(utf8Encode("wrong"), salt, 1000)),
    ).rejects.toThrow();
  });

  it("separates HKDF keys by their info label", async () => {
    const material: Bytes = randomBytes(64);
    const pin = await hkdfAesKey(material, utf8Encode("personal-vault/pin"));
    expect(pin.extractable).toBe(false);
    expect(await roundTrip(pin, await hkdfAesKey(material, utf8Encode("personal-vault/pin")))).toBe(
      "hi",
    );
    await expect(
      roundTrip(pin, await hkdfAesKey(material, utf8Encode("personal-vault/biometric"))),
    ).rejects.toThrow();
  });
});
