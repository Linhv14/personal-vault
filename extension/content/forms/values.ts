import {
  bareRegion,
  countryOf,
  foldText,
  regionNames,
  US_STATES,
} from "../../../src/core/address-data.js";
import { nationalPhone } from "../../../src/core/phone.js";
import type { AddressData, CardData } from "../../lib/autofill-protocol.js";
import { CARD_BRAND_NAMES, type CardBrand } from "../../lib/item-types.js";
import {
  rawDescription,
  type AddressFieldKind,
  type CardFieldKind,
  type DetectedField,
  type FormField,
} from "./classify.js";

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const BRAND_ALIASES: Record<CardBrand, string[]> = {
  visa: ["visa"],
  mastercard: ["mastercard", "master card", "mc", "master"],
  amex: ["amex", "american express", "americanexpress"],
  discover: ["discover"],
  jcb: ["jcb"],
  unionpay: ["unionpay", "union pay", "cup"],
  diners: ["diners", "diners club", "dinersclub"],
  card: [],
};

function options(select: HTMLSelectElement): HTMLOptionElement[] {
  return [...select.options].filter((option) => !option.disabled);
}

export function chooseOption(select: HTMLSelectElement, wanted: string[]): string | null {
  const targets = [...new Set(wanted.map(foldText).filter(Boolean))];
  if (targets.length === 0) {
    return null;
  }
  const choices = options(select).map((option) => ({
    option,
    keys: [foldText(option.value), foldText(option.text)].filter(Boolean),
  }));
  const exact = choices.find((choice) => choice.keys.some((key) => targets.includes(key)));
  if (exact) {
    return exact.option.value;
  }
  const loose = choices.find((choice) =>
    choice.keys.some((key) => targets.some((target) => bareRegion(key) === bareRegion(target))),
  );
  if (loose) {
    return loose.option.value;
  }
  const partial = choices.find((choice) =>
    choice.keys.some((key) =>
      targets.some(
        (target) =>
          (target.length >= 4 && key.includes(target)) || (key.length >= 4 && target.includes(key)),
      ),
    ),
  );
  return partial?.option.value ?? null;
}

function chooseNumber(select: HTMLSelectElement, matches: (value: number) => boolean) {
  const found = options(select).find((option) => {
    const value = option.value.trim() || option.text.trim();
    return /^\d{1,4}$/.test(value) && matches(Number(value));
  });
  return found?.value ?? null;
}

export function splitExpiry(expiry: string | undefined): { month: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s*[/.\- ]\s*(\d{2}|\d{4})\s*$/.exec(expiry ?? "");
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const month = Number(match[1]);
  if (month < 1 || month > 12) {
    return null;
  }
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return { month, year };
}

function hintText(element: FormField): string {
  return rawDescription(element).toLowerCase();
}

function maxLengthOf(element: FormField): number {
  return element instanceof HTMLSelectElement ? -1 : element.maxLength;
}

export function formatExpiry(element: FormField, month: number, year: number): string {
  const hint = hintText(element);
  const max = maxLengthOf(element);
  const pattern = /mm(\s*)([/\-.]?)(\s*)(yyyy|yy|aaaa|aa)\b/.exec(hint);
  let separator = pattern ? `${pattern[1]}${pattern[2]}${pattern[3]}` : "/";
  const longYear = pattern ? pattern[4]!.length === 4 : max >= 7 && max < 9;
  const mm = String(month).padStart(2, "0");
  const yy = longYear ? String(year) : String(year % 100).padStart(2, "0");
  if (max > 0) {
    for (const candidate of [separator, "/", ""]) {
      if (`${mm}${candidate}${yy}`.length <= max) {
        separator = candidate;
        break;
      }
    }
    if (`${mm}${separator}${yy}`.length > max) {
      return `${mm}${separator}${String(year % 100).padStart(2, "0")}`.slice(0, max);
    }
  }
  return `${mm}${separator}${yy}`;
}

function monthValue(element: FormField, month: number): string | null {
  if (element instanceof HTMLSelectElement) {
    return (
      chooseNumber(element, (value) => value === month) ??
      options(element).find((option) => foldText(option.text).startsWith(MONTH_NAMES[month - 1]!))
        ?.value ??
      null
    );
  }
  return element.maxLength === 1 ? String(month) : String(month).padStart(2, "0");
}

function yearValue(element: FormField, year: number): string | null {
  if (element instanceof HTMLSelectElement) {
    return chooseNumber(element, (value) => value === year || value === year % 100);
  }
  const hint = hintText(element);
  const short = element.maxLength === 2 || (/\byy\b|\baa\b/.test(hint) && !/yyyy|aaaa/.test(hint));
  return short ? String(year % 100).padStart(2, "0") : String(year);
}

function wantsNationalPhone(element: FormField, phone: string): boolean {
  if (/\btel-(national|local)\b/.test(element.getAttribute("autocomplete") ?? "")) {
    return true;
  }
  if (element.form?.querySelector('[autocomplete~="tel-country-code"]')) {
    return true;
  }
  return (
    element instanceof HTMLInputElement && element.maxLength > 0 && element.maxLength < phone.length
  );
}

function phoneFor(element: FormField, phone: string | undefined): string | undefined {
  return phone && wantsNationalPhone(element, phone) ? nationalPhone(phone) : phone;
}

function selectOrText(element: FormField, value: string | undefined, wanted?: string[]) {
  if (!value) {
    return null;
  }
  if (element instanceof HTMLSelectElement) {
    return chooseOption(element, wanted ?? [value]);
  }
  return value;
}

export function splitName(
  fullName: string | undefined,
  country?: string,
): { given: string; family: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { given: parts[0] ?? "", family: "" };
  }
  if (countryOf(country)?.code === "VN") {
    return { given: parts.slice(1).join(" "), family: parts[0]! };
  }
  return { given: parts.slice(0, -1).join(" "), family: parts.at(-1)! };
}

export function cardValue(field: DetectedField, card: CardData): string | null {
  const { element } = field;
  const expiry = splitExpiry(card.expiry);
  switch (field.kind as CardFieldKind) {
    case "cc-name":
      return selectOrText(element, card.cardholder);
    case "cc-given-name":
      return selectOrText(element, splitName(card.cardholder).given);
    case "cc-family-name":
      return selectOrText(element, splitName(card.cardholder).family);
    case "cc-number":
      return card.number;
    case "cc-csc":
      return selectOrText(element, card.cvv);
    case "cc-exp":
      if (!expiry) {
        return null;
      }
      if (element instanceof HTMLSelectElement) {
        const two = String(expiry.year % 100).padStart(2, "0");
        const mm = String(expiry.month).padStart(2, "0");
        return chooseOption(element, [`${mm}/${two}`, `${mm}/${expiry.year}`, `${mm}${two}`]);
      }
      return formatExpiry(element, expiry.month, expiry.year);
    case "cc-exp-month":
      return expiry ? monthValue(element, expiry.month) : null;
    case "cc-exp-year":
      return expiry ? yearValue(element, expiry.year) : null;
    case "cc-type": {
      const name = CARD_BRAND_NAMES[card.brand];
      return selectOrText(element, name, [name, ...BRAND_ALIASES[card.brand]]);
    }
  }
}

function streetLines(data: AddressData, fields: DetectedField[]): [string[], string[]] {
  const lines = (data.address ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasWardField = fields.some((field) => field.kind === "address-level3");
  const rest = lines.slice(1);
  if (data.ward && !hasWardField) {
    rest.push(data.ward);
  }
  return [lines.slice(0, 1), rest];
}

function countryValue(field: DetectedField, data: AddressData): string | null {
  const country = countryOf(data.country);
  const { element } = field;
  if (element instanceof HTMLSelectElement) {
    return chooseOption(element, country ? [country.code, ...country.names] : [data.country ?? ""]);
  }
  if (!country) {
    return data.country ?? null;
  }
  const wantsCode = field.kind === "country" || (element.maxLength > 0 && element.maxLength <= 3);
  return wantsCode ? country.code : (country.names[0] ?? null);
}

function regionValue(element: FormField, region: string | undefined): string | null {
  if (!region) {
    return null;
  }
  if (element instanceof HTMLSelectElement) {
    return chooseOption(element, regionNames(region));
  }
  const state = US_STATES.find(([code, name]) => code === region || name === region);
  if (state && element.maxLength === 2) {
    return state[0];
  }
  return region;
}

export function addressValue(
  field: DetectedField,
  data: AddressData,
  fields: DetectedField[],
): string | null {
  const { element } = field;
  const [first, rest] = streetLines(data, fields);
  const hasLine2 = fields.some((other) => other.kind === "address-line2");
  const name = splitName(data.fullName, data.country);
  switch (field.kind as AddressFieldKind) {
    case "name":
      return selectOrText(element, data.fullName);
    case "given-name":
      return selectOrText(element, name.given);
    case "family-name":
      return selectOrText(element, name.family);
    case "email":
      return selectOrText(element, data.email);
    case "tel":
      return selectOrText(element, phoneFor(element, data.phone));
    case "organization":
      return selectOrText(element, data.company);
    case "street-address": {
      const lines = hasLine2 ? first : [...first, ...rest];
      return element instanceof HTMLTextAreaElement
        ? lines.join("\n") || null
        : lines.join(", ") || null;
    }
    case "address-line1":
      return (hasLine2 ? first : [...first, ...rest]).join(", ") || null;
    case "address-line2":
      return rest.join(", ") || null;
    case "address-level1":
      return regionValue(element, data.region);
    case "address-level2":
      return selectOrText(element, data.city, regionNames(data.city));
    case "address-level3":
      return selectOrText(element, data.ward, regionNames(data.ward));
    case "postal-code":
      return selectOrText(element, data.postalCode);
    case "country":
    case "country-name":
      return countryValue(field, data);
  }
}

export function countryHint(fields: DetectedField[], hostname: string, lang: string): "US" | "VN" {
  for (const field of fields) {
    if (!field.kind.startsWith("country")) {
      continue;
    }
    const code = countryOf(field.element.value)?.code;
    if (code === "VN" || code === "US") {
      return code;
    }
  }
  return hostname.endsWith(".vn") || lang.toLowerCase().startsWith("vi") ? "VN" : "US";
}
