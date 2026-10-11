/**
 * Chuyển đổi byte <-> text. Chỉ dùng API có sẵn ở cả browser, Workers và Node,
 * để `src/core` chạy được ở ba môi trường mà không cần polyfill.
 */

/**
 * TS 5.7 trở lên biến `Uint8Array` thành generic trên loại buffer, còn WebCrypto
 * chỉ nhận `ArrayBufferView<ArrayBuffer>`. Dùng alias này xuyên suốt để khỏi rải
 * `as any` ở mọi chỗ gọi `crypto.subtle`.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8Encode(s: string): Bytes {
  // Copy lại để buffer là ArrayBuffer thật, không phải ArrayBufferLike.
  return new Uint8Array(textEncoder.encode(s));
}

export function utf8Decode(b: Uint8Array): string {
  return textDecoder.decode(b);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

export function fromBase64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * base64url (RFC 4648 §5) — dùng cho khoá nằm trong URL fragment của link share.
 * base64 thường có `+` và `/`, hai ký tự này bị mã hoá lại trong URL và sẽ làm
 * khoá sai khi người nhận đọc `location.hash`.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return fromBase64(padded);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0) throw new Error("hex phải có số ký tự chẵn");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * So sánh hai mảng byte trong thời gian không phụ thuộc nội dung.
 * So sánh bằng `===` trên chuỗi sẽ dừng sớm ở byte đầu tiên khác nhau, và thời
 * gian dừng đó tiết lộ ta đã khớp được bao nhiêu byte — đủ để dò dần một token.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
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
