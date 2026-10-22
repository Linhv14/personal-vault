import { timingSafeEqual, utf8Encode, type Bytes } from "./bytes.js";

export async function pbkdf2Bits(
  secret: Bytes,
  salt: Bytes,
  iterations: number,
  bits: number,
): Promise<Bytes> {
  const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      base,
      bits,
    ),
  );
}

export async function pbkdf2AesKey(
  secret: Bytes,
  salt: Bytes,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function hkdfAesKey(material: Bytes, info: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sha1(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", data));
}

export async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function hmacSha256(key: Bytes, message: Bytes): Promise<Bytes> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, message));
}

export async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(utf8Encode(provided)), sha256(utf8Encode(expected))]);
  return timingSafeEqual(a, b);
}
