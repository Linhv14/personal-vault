/**
 * Byte <-> text conversions. Uses only APIs available in browsers, Workers and
 * Node, so `src/core` runs in all three without polyfills.
 */

/**
 * TypeScript 5.7+ made `Uint8Array` generic over its buffer type, while WebCrypto
 * only accepts `ArrayBufferView<ArrayBuffer>`. Using this alias throughout avoids
 * sprinkling `as any` at every `crypto.subtle` call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8Encode(s: string): Bytes {
  // Copy so the backing store is a real ArrayBuffer, not ArrayBufferLike.
  return new Uint8Array(textEncoder.encode(s));
}

export function utf8Decode(b: Uint8Array): string {
  return textDecoder.decode(b);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) {
    s += String.fromCharCode(byte);
  }
  return btoa(s);
}

export function fromBase64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i);
  }
  return out;
}

/**
 * base64url (RFC 4648 §5) — used for the key carried in a share link's URL
 * fragment. Standard base64 contains `+` and `/`, which get percent-encoded in a
 * URL and would corrupt the key by the time the recipient reads `location.hash`.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return fromBase64(padded);
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Compare two byte arrays in time independent of their contents.
 *
 * A plain `===` on strings short-circuits at the first differing byte, and the
 * time it takes to bail reveals how many bytes matched — enough to recover a
 * token one byte at a time.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
