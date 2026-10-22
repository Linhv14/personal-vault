/**
 * base32 per RFC 4648 §6 — the encoding every site uses to show a TOTP secret
 * ("JBSWY3DPEHPK3PXP"). Not base32hex, not Crockford.
 */

import type { Bytes } from "./bytes.js";
import { VaultError } from "./errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode base32, being forgiving about what a human pastes in: strip spaces and
 * dashes (sites often display "jbsw y3dp ehpk"), accept lowercase, drop padding.
 */
export function base32Decode(input: string): Bytes {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) {
    return new Uint8Array(0);
  }

  const out: number[] = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) {
      throw new VaultError(
        "base32.invalid_character",
        { char },
        `Invalid base32 character: ${char}`,
      );
    }
    // Each base32 character carries exactly 5 bits. Accumulate, then drain in
    // 8-bit chunks.
    buffer = (buffer << 5) | value;
    bitsInBuffer += 5;
    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out.push((buffer >> bitsInBuffer) & 0xff);
    }
  }

  // Leftover bits are the final character's padding — discard them, per the RFC.
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

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

  // Pad to a multiple of 8 characters.
  while (out.length % 8 !== 0) {
    out += "=";
  }
  return out;
}

/** Validate a string before treating it as a TOTP secret. */
export function isValidBase32(input: string): boolean {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) {
    return false;
  }
  return [...clean].every((c) => ALPHABET.includes(c));
}
