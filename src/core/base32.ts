/**
 * base32 theo RFC 4648 §6 — định dạng mà mọi site dùng để hiện TOTP secret
 * ("JBSWY3DPEHPK3PXP"). Không dùng base32hex, không dùng Crockford.
 */

import type { Bytes } from "./bytes.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Giải mã base32. Dễ tính với input người dùng dán vào: bỏ khoảng trắng và dấu
 * gạch (site hay hiện "jbsw y3dp ehpk"), chấp nhận chữ thường, bỏ padding `=`.
 */
export function base32Decode(input: string): Bytes {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return new Uint8Array(0);

  const out: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Ký tự không hợp lệ trong base32: "${char}"`);
    }
    // Mỗi ký tự base32 mang đúng 5 bit. Dồn vào buffer rồi rút ra từng 8 bit.
    buffer = (buffer << 5) | value;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out.push((buffer >> bitsInBuffer) & 0xff);
    }
  }

  // Các bit lẻ còn lại là padding của ký tự cuối, bỏ đi — đúng theo RFC.
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let out = "";
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      out += ALPHABET[(buffer >> bitsInBuffer) & 0x1f];
    }
  }

  if (bitsInBuffer > 0) {
    out += ALPHABET[(buffer << (5 - bitsInBuffer)) & 0x1f];
  }

  // Padding tới bội số của 8 ký tự.
  while (out.length % 8 !== 0) out += "=";
  return out;
}

/** Kiểm tra một chuỗi có phải base32 hợp lệ — dùng để validate ô nhập TOTP. */
export function isValidBase32(input: string): boolean {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return false;
  return [...clean].every((c) => ALPHABET.includes(c));
}
