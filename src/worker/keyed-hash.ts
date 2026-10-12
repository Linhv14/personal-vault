import { toBase64, utf8Encode } from "../core/bytes.js";

export async function keyedHashBytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8Encode(message)));
}

export async function keyedHash(secret: string, message: string): Promise<string> {
  return toBase64(await keyedHashBytes(secret, message));
}
