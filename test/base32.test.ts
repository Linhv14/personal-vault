import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, isValidBase32 } from "../src/core/base32.js";
import { utf8Decode, utf8Encode } from "../src/core/bytes.js";

/** Vector chuẩn RFC 4648 §10. Nếu một trong các dòng này sai thì TOTP sai theo. */
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
  it.each(RFC4648_VECTORS)("mã hoá %o thành %o (RFC 4648)", (plain, encoded) => {
    expect(base32Encode(utf8Encode(plain))).toBe(encoded);
  });

  it.each(RFC4648_VECTORS)("giải mã %o từ %o (RFC 4648)", (plain, encoded) => {
    expect(utf8Decode(base32Decode(encoded))).toBe(plain);
  });

  it("chấp nhận chữ thường, khoảng trắng và gạch ngang như site hay hiện", () => {
    const expected = base32Decode("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi")).toEqual(expected);
    expect(base32Decode("MZXW-6YTB-OI")).toEqual(expected);
    expect(base32Decode("mzxw6ytboi======")).toEqual(expected);
  });

  it("từ chối ký tự ngoài bảng chữ cái", () => {
    // 0, 1, 8, 9 không có trong base32 RFC 4648 — chúng dễ bị nhầm với O, I, B, g.
    expect(() => base32Decode("MZXW0YTB")).toThrow(/không hợp lệ/);
    expect(() => base32Decode("MZXW1YTB")).toThrow();
  });

  it("isValidBase32 phân biệt được secret thật và chuỗi rác", () => {
    expect(isValidBase32("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(isValidBase32("jbsw y3dp ehpk 3pxp")).toBe(true);
    expect(isValidBase32("")).toBe(false);
    expect(isValidBase32("not-base32!")).toBe(false);
  });

  it("round-trip với byte ngẫu nhiên ở mọi độ dài lệch nhóm 5 byte", () => {
    for (let length = 1; length <= 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });
});
