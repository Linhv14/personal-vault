import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en.js";
import { vi } from "../src/i18n/vi.js";
import { createTranslator, describeError, detectLocale, LOCALES } from "../src/i18n/index.js";
import { VaultError } from "../src/core/errors.js";

const CATALOGUES = { en, vi } as const;

describe("message catalogues", () => {
  it("every locale defines exactly the same keys", () => {
    const expected = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(CATALOGUES[locale]).sort(), `locale ${locale}`).toEqual(expected);
    }
  });

  it("no translation is left empty", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("every locale uses the same placeholders as English", () => {
    // A translation that drops `{seconds}` silently renders an incomplete
    // sentence; one that invents a placeholder renders a literal brace.
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(placeholders(value), `${locale}:${key}`).toEqual(
          placeholders(en[key as keyof typeof en]),
        );
      }
    }
  });

  it("covers every VaultError code", () => {
    // Guards against adding a code in core and forgetting the message, which
    // would surface to the user as a raw identifier.
    const codes: string[] = [
      "base32.invalid_character",
      "totp.empty_secret",
      "totp.invalid_uri",
      "totp.not_totp",
      "totp.missing_secret",
      "totp.unsupported_algorithm",
      "totp.unrecognized_input",
      "crypto.unsupported_kdf",
      "crypto.empty_password",
      "crypto.wrong_password",
      "crypto.bad_key_length",
      "share.passphrase_required",
      "share.invalid_key",
      "share.wrong_passphrase",
      "share.undecryptable",
      "generator.no_character_set",
      "generator.length_too_short",
      "generator.length_too_long",
      "generator.too_few_words",
      "generator.too_many_words",
      "generator.wordlist_too_small",
      "generator.pin_length_out_of_range",
      "generator.invalid_max",
    ];
    for (const code of codes) {
      expect(en, code).toHaveProperty(`error.${code}`);
    }
  });
});

describe("createTranslator", () => {
  it("substitutes placeholders", () => {
    const t = createTranslator("en");
    expect(t("gen.entropy", { bits: 82.7, strength: "strong" })).toBe("82.7 bits — strong");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    const t = createTranslator("en");
    expect(t("gen.entropy", { bits: 10 })).toContain("{strength}");
  });

  it("returns a different language for a different locale", () => {
    expect(createTranslator("en")("common.copy")).not.toBe(createTranslator("vi")("list.lock_now"));
    expect(createTranslator("vi")("unlock.title")).toBe("Mở vault");
  });
});

describe("detectLocale", () => {
  it("matches on the primary subtag", () => {
    expect(detectLocale(["vi-VN", "en-US"])).toBe("vi");
    expect(detectLocale(["en-GB"])).toBe("en");
  });

  it("falls back to English for unsupported languages", () => {
    expect(detectLocale(["ja-JP", "ko"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });
});

describe("describeError", () => {
  it("localizes a VaultError by code", () => {
    const error = new VaultError("crypto.wrong_password");
    expect(describeError(error, createTranslator("en"))).toBe("Incorrect master password");
    expect(describeError(error, createTranslator("vi"))).toBe("Master password không đúng");
  });

  it("interpolates params from the error", () => {
    const error = new VaultError("generator.too_few_words", { min: 2 });
    expect(describeError(error, createTranslator("en"))).toContain("2");
  });

  it("falls back to the raw message for unexpected errors", () => {
    // Hiding a genuine bug behind a friendly phrase makes it undebuggable.
    expect(describeError(new Error("boom"), createTranslator("en"))).toBe("boom");
    expect(describeError("plain string", createTranslator("en"))).toBe("plain string");
  });
});
