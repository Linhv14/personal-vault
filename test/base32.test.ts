import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, isValidBase32 } from "../src/core/base32.js";
import { utf8Decode, utf8Encode } from "../src/core/bytes.js";
import { expectCode } from "./helpers.js";

const RFC4648_VECTORS: Array<[string, string]> = [
  ["", ""],
  ["f", "MY======"],
  ["fo", "MZXQ===="],
  ["foo", "MZXW6==="],
  ["foob", "MZXW6YQ="],
  ["fooba", "MZXW6YTB"],
  ["foobar", "MZXW6YTBOI======"],
];

describe("base32", () => {
  it.each(RFC4648_VECTORS)("encodes %o to %o (RFC 4648)", (plain, encoded) => {
    expect(base32Encode(utf8Encode(plain))).toBe(encoded);
  });

  it.each(RFC4648_VECTORS)("decodes %o from %o (RFC 4648)", (plain, encoded) => {
    expect(utf8Decode(base32Decode(encoded))).toBe(plain);
  });

  it("accepts lowercase, spaces and dashes, as sites display them", () => {
    const expected = base32Decode("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi")).toEqual(expected);
    expect(base32Decode("MZXW-6YTB-OI")).toEqual(expected);
    expect(base32Decode("mzxw6ytboi======")).toEqual(expected);
  });

  it("rejects characters outside the alphabet", () => {
    expectCode(() => base32Decode("MZXW0YTB"), "base32.invalid_character");
    expectCode(() => base32Decode("MZXW1YTB"), "base32.invalid_character");
  });

  it("isValidBase32 separates real secrets from noise", () => {
    expect(isValidBase32("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(isValidBase32("jbsw y3dp ehpk 3pxp")).toBe(true);
    expect(isValidBase32("")).toBe(false);
    expect(isValidBase32("not-base32!")).toBe(false);
  });

  it("round-trips random bytes at every length off the 5-byte boundary", () => {
    for (let length = 1; length <= 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });
});
