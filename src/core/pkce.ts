import { randomBytes, toBase64Url, utf8Encode } from "./bytes.js";
import { sha256 } from "./primitives.js";

export function pkceVerifier(): string {
  return toBase64Url(randomBytes(32));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(utf8Encode(verifier)));
}
