import { describe, expect, it } from "vitest";
import {
  buildAlphabet,
  generatePassphrase,
  generatePassword,
  generatePin,
  randomInt,
  rateStrength,
} from "../src/core/generator.js";
import { EFF_SHORT_WORDLIST } from "../src/core/wordlist.js";
import { expectCode } from "./helpers.js";

describe("randomInt", () => {
  it("always lands inside [0, max)", () => {
    for (const max of [2, 3, 10, 26, 95, 1296]) {
      for (let i = 0; i < 500; i++) {
        const n = randomInt(max);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(max);
      }
    }
  });

  it("returns 0 for max = 1 without looping forever", () => {
    expect(randomInt(1)).toBe(0);
  });

  it("rejects an invalid max", () => {
    expectCode(() => randomInt(0), "generator.invalid_max");
    expectCode(() => randomInt(-5), "generator.invalid_max");
    expectCode(() => randomInt(2.5), "generator.invalid_max");
  });

  it("shows no measurable bias for a max that does not divide 2^32", () => {
    const counts = [0, 0, 0];
    const samples = 30_000;
    for (let i = 0; i < samples; i++) {
      counts[randomInt(3)]! += 1;
    }
    for (const count of counts) {
      expect(Math.abs(count / samples - 1 / 3)).toBeLessThan(0.02);
    }
  });
});

describe("buildAlphabet", () => {
  it("includes all four sets by default", () => {
    const alphabet = buildAlphabet();
    expect(alphabet).toMatch(/[a-z]/);
    expect(alphabet).toMatch(/[A-Z]/);
    expect(alphabet).toMatch(/[0-9]/);
    expect(alphabet).toMatch(/[!@#]/);
  });

  it("drops look-alike characters when asked", () => {
    const alphabet = buildAlphabet({ excludeAmbiguous: true });
    for (const char of ["0", "O", "o", "I", "l", "1"]) {
      expect(alphabet).not.toContain(char);
    }
  });

  it("fails when no set is selected", () => {
    expectCode(
      () => buildAlphabet({ lowercase: false, uppercase: false, digits: false, symbols: false }),
      "generator.no_character_set",
    );
  });
});

describe("generatePassword", () => {
  it("honours the requested length", () => {
    for (const length of [8, 16, 20, 64, 256]) {
      expect(generatePassword({ length }).value).toHaveLength(length);
    }
  });

  it("always includes at least one character from every selected set", () => {
    for (let i = 0; i < 200; i++) {
      const { value } = generatePassword({ length: 12 });
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[!@#$%^&*()\-_=+[\]{};:,.?]/);
    }
  });

  it("uses only the enabled sets", () => {
    for (let i = 0; i < 100; i++) {
      const { value } = generatePassword({ length: 24, uppercase: false, symbols: false });
      expect(value).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("does not leave the mandatory characters bunched at the front", () => {
    let digitInFirstFour = 0;
    const runs = 400;
    for (let i = 0; i < runs; i++) {
      if (/[0-9]/.test(generatePassword({ length: 20 }).value.slice(0, 4))) {
        digitInFirstFour += 1;
      }
    }
    expect(digitInFirstFour).toBeLessThan(runs * 0.9);
  });

  it("never repeats a password", () => {
    const values = new Set(Array.from({ length: 200 }, () => generatePassword().value));
    expect(values.size).toBe(200);
  });

  it("reports entropy as length * log2(alphabet)", () => {
    const alphabet = buildAlphabet();
    const { entropyBits } = generatePassword({ length: 20 });
    expect(entropyBits).toBeCloseTo(20 * Math.log2(alphabet.length), 1);
  });

  it("rejects lengths that are too short or too long", () => {
    expectCode(() => generatePassword({ length: 3 }), "generator.length_too_short");
    expectCode(() => generatePassword({ length: 257 }), "generator.length_too_long");
  });
});

describe("generatePassphrase", () => {
  it("defaults to 8 dash-separated words from the list", () => {
    const { value } = generatePassphrase();
    const words = value.split("-");
    expect(words).toHaveLength(8);
    for (const word of words) {
      expect(EFF_SHORT_WORDLIST).toContain(word);
    }
  });

  it("computes entropy from the real list length", () => {
    const { entropyBits } = generatePassphrase({ words: 6 });
    expect(entropyBits).toBeCloseTo(6 * Math.log2(1296), 1);
  });

  it("ships exactly 1296 unique words", () => {
    expect(EFF_SHORT_WORDLIST).toHaveLength(1296);
    expect(new Set(EFF_SHORT_WORDLIST).size).toBe(1296);
  });

  it("supports capitalization and an appended digit", () => {
    const { value, entropyBits } = generatePassphrase({
      words: 4,
      capitalize: true,
      appendDigit: true,
      separator: ".",
    });
    const parts = value.split(".");
    expect(parts).toHaveLength(5);
    for (const word of parts.slice(0, 4)) {
      expect(word[0]).toMatch(/[A-Z]/);
    }
    expect(parts[4]).toMatch(/^[0-9]$/);
    expect(entropyBits).toBeCloseTo(4 * Math.log2(1296) + Math.log2(10), 1);
  });

  it("accepts a custom word list", () => {
    const { value, entropyBits } = generatePassphrase({ words: 3, wordlist: ["cat", "dog"] });
    expect(value.split("-").every((w) => ["cat", "dog"].includes(w))).toBe(true);
    expect(entropyBits).toBe(3);
  });

  it("rejects nonsensical options", () => {
    expectCode(() => generatePassphrase({ words: 1 }), "generator.too_few_words");
    expectCode(() => generatePassphrase({ words: 33 }), "generator.too_many_words");
    expectCode(
      () => generatePassphrase({ wordlist: ["only-one"] }),
      "generator.wordlist_too_small",
    );
  });
});

describe("generatePin", () => {
  it("produces digits of the requested length", () => {
    const { value, entropyBits } = generatePin(6);
    expect(value).toMatch(/^\d{6}$/);
    expect(entropyBits).toBeCloseTo(6 * Math.log2(10), 1);
  });

  it("rejects lengths outside the allowed range", () => {
    expectCode(() => generatePin(2), "generator.pin_length_out_of_range");
    expectCode(() => generatePin(33), "generator.pin_length_out_of_range");
  });
});

describe("rateStrength", () => {
  it("bands by entropy", () => {
    expect(rateStrength(30)).toBe("very_weak");
    expect(rateStrength(50)).toBe("weak");
    expect(rateStrength(70)).toBe("fair");
    expect(rateStrength(90)).toBe("strong");
    expect(rateStrength(130)).toBe("very_strong");
  });

  it("rates both defaults strong or better", () => {
    expect(rateStrength(generatePassword().entropyBits)).toMatch(/strong/);
    expect(rateStrength(generatePassphrase().entropyBits)).toMatch(/strong/);
  });
});
