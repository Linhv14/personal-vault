import { concat, fromBase64, utf8Encode, type Bytes } from "../../src/core/bytes.js";

export async function deviceWrappingKey(
  serverKey: string,
  local: Bytes,
  purpose: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    concat(fromBase64(serverKey), local),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8Encode(purpose) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
