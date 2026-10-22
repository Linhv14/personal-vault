import { describe, expect, it } from "vitest";
import { fromBase64, fromBase64Url, toBase64, toBase64Url } from "../src/core/bytes.js";

describe("base64", () => {
  it("decodes padded and unpadded input", () => {
    expect(Array.from(fromBase64("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(fromBase64("AQI="))).toEqual([1, 2]);
    expect(Array.from(fromBase64("AQI"))).toEqual([1, 2]);
  });

  it("ignores ASCII whitespace like armored and data URL payloads", () => {
    expect(Array.from(fromBase64(" AQ\nID\r\n\t"))).toEqual([1, 2, 3]);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => fromBase64("AQ-_")).toThrow();
  });

  it("round-trips every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(all))).toEqual(all);
  });
});

describe("base64url", () => {
  it("uses the URL-safe alphabet without padding", () => {
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe("-_8");
    expect(Array.from(fromBase64Url("-_8"))).toEqual([0xfb, 0xff]);
  });

  it("round-trips every length up to a full block", () => {
    for (let n = 0; n <= 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => 250 - i);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });
});
