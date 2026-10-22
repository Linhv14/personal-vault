import { signal } from "@preact/signals";
import { createTranslator, resolveLocale, type Locale, type Translate } from "#i18n/index.js";

export const localeSignal = signal<Locale>("en");

export function setUiLocale(preference: Parameters<typeof resolveLocale>[0]): Locale {
  const locale = resolveLocale(preference);
  localeSignal.value = locale;
  return locale;
}

export function useT(): Translate {
  return createTranslator(localeSignal.value);
}
