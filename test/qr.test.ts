import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeQr,
  formatBits,
  qrPath,
  reedSolomonDivisor,
  reedSolomonRemainder,
  type QrErrorLevel,
} from "../src/core/qr.js";

interface Vector {
  text: string;
  level: QrErrorLevel;
  version: number;
  mask: number;
  rows: string[];
}

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/qr-vectors.json", import.meta.url), "utf8"),
) as Vector[];

const hexRows = (modules: boolean[][]) =>
  modules.map((row) =>
    BigInt("0b" + row.map((dark) => (dark ? "1" : "0")).join(""))
      .toString(16)
      .padStart(Math.ceil(row.length / 4), "0"),
  );

function readFormat(modules: boolean[][]): number {
  let bits = 0;
  const at = (x: number, y: number, index: number) => {
    if (modules[y]![x]) {
      bits |= 1 << index;
    }
  };
  for (let i = 0; i <= 5; i++) {
    at(8, i, i);
  }
  at(8, 7, 6);
  at(8, 8, 7);
  at(7, 8, 8);
  for (let i = 9; i < 15; i++) {
    at(14 - i, 8, i);
  }
  return bits;
}

describe("QR encoder", () => {
  it.each(vectors.map((vector) => [`${vector.version}-${vector.level}`, vector] as const))(
    "matches a reference encoder module for module (%s)",
    (_name, vector) => {
      const code = encodeQr(vector.text, {
        level: vector.level,
        version: vector.version,
        mask: vector.mask,
      });
      expect(code.version).toBe(vector.version);
      expect(code.size).toBe(vector.version * 4 + 17);
      expect(hexRows(code.modules)).toEqual(vector.rows);
    },
  );

  it("computes Reed-Solomon codewords for the textbook 1-M example", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("produces the published format strings", () => {
    expect(formatBits("L", 4).toString(2).padStart(15, "0")).toBe("110011000101111");
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("H", 7).toString(2).padStart(15, "0")).toBe("000100000111011");
  });

  it("writes the mask it picked into the format area", () => {
    const code = encodeQr("otpauth://totp/7key:owner%40example.com?secret=JBSWY3DPEHPK3PXP");
    expect(readFormat(code.modules)).toBe(formatBits("M", code.mask));
  });

  it("encodes UTF-8 and grows the version to fit", () => {
    expect(encodeQr("é").version).toBe(1);
    expect(encodeQr("é".repeat(100)).version).toBeGreaterThan(5);
    expect(() => encodeQr("x".repeat(3000))).toThrow(RangeError);
    expect(() => encodeQr("x".repeat(50), { version: 1 })).toThrow(RangeError);
  });

  it("draws one square per dark module inside a quiet zone", () => {
    const code = encodeQr("7key");
    const dark = code.modules.flat().filter(Boolean).length;
    const path = qrPath(code);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
