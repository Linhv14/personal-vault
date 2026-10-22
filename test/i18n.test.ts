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
    const placeholders = (text: string) =>
      [...new Set([...text.matchAll(/\{(\w+)(?:\}|,\s*plural,)/g)].map((m) => m[1]))].sort();

    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(placeholders(value), `${locale}:${key}`).toEqual(
          placeholders(en[key as keyof typeof en]),
        );
      }
    }
  });

  it("covers every VaultError code", () => {
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
    expect(t("gen.entropy", { bits: 82.7, strength: "strong" })).toBe("82.7 bits · strong");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    const t = createTranslator("en");
    expect(t("gen.entropy", { bits: 10 })).toContain("{strength}");
  });

  it("returns a different language for a different locale", () => {
    expect(createTranslator("en")("common.copy")).not.toBe(createTranslator("vi")("list.lock_now"));
    expect(createTranslator("en")("unlock.submit")).toBe("Unlock");
    expect(createTranslator("vi")("unlock.submit")).toBe("Mở");
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
    expect(describeError(error, createTranslator("vi"))).toBe("Sai mật khẩu chính");
  });

  it("interpolates params from the error", () => {
    const error = new VaultError("generator.too_few_words", { min: 2 });
    expect(describeError(error, createTranslator("en"))).toContain("2");
  });

  it("falls back to the raw message for unexpected errors", () => {
    expect(describeError(new Error("boom"), createTranslator("en"))).toBe("boom");
  });

  it("localizes errors from the API client by their message key", () => {
    const apiError = Object.assign(new Error("error.auth.invalid_credentials"), {
      messageKey: "error.auth.invalid_credentials",
      params: {},
    });
    expect(describeError(apiError, createTranslator("en"))).toBe(
      "Incorrect email or master password",
    );
    expect(describeError(apiError, createTranslator("vi"))).not.toContain("error.");

    const unknownKey = Object.assign(new Error("error.nope"), { messageKey: "error.nope" });
    expect(describeError(unknownKey, createTranslator("en"))).toBe("error.nope");
    expect(describeError("plain string", createTranslator("en"))).toBe("plain string");
  });

  it("picks the plural form for the count instead of writing (s)", () => {
    const en = createTranslator("en");
    expect(en("links.views_left", { views: 1 })).toBe("1 view left");
    expect(en("links.views_left", { views: 4 })).toBe("4 views left");
    expect(en("share.protection_emails", { count: 2 })).toBe("2 emails");
    expect(createTranslator("vi")("links.views_left", { views: 4 })).toBe("Còn 4 lượt xem");
  });

  it("states numbers exactly, never with (s) or an approximation", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(value, `${locale}:${key}`).not.toMatch(/\(s\)|~\{|≈/);
      }
    }
  });
});

describe("plural numbers", () => {
  it("formats the count the way the locale writes numbers", async () => {
    const { createTranslator } = await import("../src/i18n/index.js");
    expect(createTranslator("en")("health.breached_hint", { count: 9643893 })).toBe(
      "Seen 9,643,893 times in data breaches",
    );
    expect(createTranslator("vi")("health.breached_hint", { count: 9643893 })).toBe(
      "Xuất hiện 9.643.893 lần trong các vụ rò rỉ",
    );
  });
});
