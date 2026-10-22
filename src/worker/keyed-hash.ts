import { hmacSha256 } from "../core/primitives.js";
import { toBase64, utf8Encode } from "../core/bytes.js";

export async function keyedHashBytes(secret: string, message: string): Promise<Uint8Array> {
  return hmacSha256(utf8Encode(secret), utf8Encode(message));
}

export async function keyedHash(secret: string, message: string): Promise<string> {
  return toBase64(await keyedHashBytes(secret, message));
}
