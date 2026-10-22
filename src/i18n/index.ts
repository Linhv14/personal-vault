/**
 * Minimal i18n layer.
 *
 * Hand-rolled rather than pulled from npm for the same reason `src/core` has no
 * dependencies: this code runs inside the extension that holds every password
 * you own, and an i18n library is a lot of third-party code for what amounts to
 * a lookup and a string replace.
 *
 * Translation happens only at the UI edge. Nothing below this layer — not the
 * crypto, not the worker, not the vault model — knows what language is active.
 */

import { en, type Catalogue, type MessageKey } from "./en.js";
import { vi } from "./vi.js";
import { isVaultError } from "../core/errors.js";

export type Locale = "en" | "vi";
/** `auto` follows the browser; an explicit locale overrides it. */
export type LocalePreference = Locale | "auto";

export const LOCALES: readonly Locale[] = ["en", "vi"];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

const CATALOGUES: Record<Locale, Catalogue> = { en, vi };

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Pick a locale from the browser's language list.
 *
 * Matches on the primary subtag so `vi-VN` resolves to `vi`. Falls back to
 * English, which is also the catalogue that is guaranteed complete.
 */
export function detectLocale(languages: readonly string[] = navigator.languages ?? []): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split("-")[0];
    const match = LOCALES.find((locale) => locale === primary);
    if (match) {
      return match;
    }
  }
  return "en";
}

export function resolveLocale(preference: LocalePreference | undefined): Locale {
  return !preference || preference === "auto" ? detectLocale() : preference;
}

export function createTranslator(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale];

  const plurals = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);

  return (key, params) => {
    const template = catalogue[key];
    if (!params) {
      return template;
    }

    // `{name}` -> value. An unknown placeholder is left as-is so a typo shows up
    // in the UI instead of silently rendering an empty string.
    return template
      .replace(PLURAL_BLOCK, (match, name: string, body: string) => {
        if (!(name in params)) {
          return match;
        }
        const count = Number(params[name]);
        const forms: Record<string, string> = Object.fromEntries(
          [...body.matchAll(/(=?\w+)\s*\{([^{}]*)\}/g)].map(
            ([, form, text]) => [form!, text!] as const,
          ),
        );
        const text = forms[`=${count}`] ?? forms[plurals.select(count)] ?? forms.other ?? match;
        return text.replace(/#/g, numbers.format(count));
      })
      .replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
  };
}

const PLURAL_BLOCK = /\{(\w+),\s*plural,((?:\s*=?\w+\s*\{[^{}]*\})+)\s*\}/g;

/**
 * Turn anything thrown anywhere into a sentence in the active language.
 *
 * `VaultError` carries a stable code, so it localizes exactly. Anything else —
 * a bug, a DOM exception — falls back to its own message, which is in English
 * and aimed at developers; that is better than hiding a real failure behind a
 * generic phrase.
 */
export function describeError(error: unknown, t: Translate): string {
  if (isVaultError(error)) {
    return t(`error.${error.code}` as MessageKey, error.params);
  }
  if (isLocalizedApiError(error)) {
    return t(error.messageKey, error.params);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isLocalizedApiError(
  error: unknown,
): error is { messageKey: MessageKey; params?: Record<string, string | number> } {
  const messageKey = (error as { messageKey?: unknown } | null)?.messageKey;
  return typeof messageKey === "string" && messageKey in en;
}

export type { MessageKey, Catalogue };
