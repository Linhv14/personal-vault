import {
  bareRegion,
  countryOf,
  foldText,
  regionNames,
  US_STATES,
} from "../../src/core/address-data.js";
import type { AddressData, CardData } from "../lib/autofill-protocol.js";
import { CARD_BRAND_NAMES, type CardBrand } from "../lib/item-types.js";

export type CardFieldKind =
  | "cc-name"
  | "cc-given-name"
  | "cc-family-name"
  | "cc-number"
  | "cc-exp"
  | "cc-exp-month"
  | "cc-exp-year"
  | "cc-csc"
  | "cc-type";

export type AddressFieldKind =
  | "name"
  | "given-name"
  | "family-name"
  | "email"
  | "tel"
  | "organization"
  | "street-address"
  | "address-line1"
  | "address-line2"
  | "address-level1"
  | "address-level2"
  | "address-level3"
  | "postal-code"
  | "country"
  | "country-name";

export type FormFieldKind = CardFieldKind | AddressFieldKind;
export type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export type FormKind = "card" | "address";

export interface DetectedField {
  element: FormField;
  kind: FormFieldKind;
}

export type Setter = (element: FormField, value: string) => void;

const TOKENS: Record<string, FormFieldKind> = {
  "cc-name": "cc-name",
  "cc-given-name": "cc-given-name",
  "cc-family-name": "cc-family-name",
  "cc-number": "cc-number",
  "cc-exp": "cc-exp",
  "cc-exp-month": "cc-exp-month",
  "cc-exp-year": "cc-exp-year",
  "cc-csc": "cc-csc",
  "cc-type": "cc-type",
  name: "name",
  "given-name": "given-name",
  "family-name": "family-name",
  email: "email",
  tel: "tel",
  "tel-national": "tel",
  organization: "organization",
  "street-address": "street-address",
  "address-line1": "address-line1",
  "address-line2": "address-line2",
  "address-line3": "address-line2",
  "address-level1": "address-level1",
  "address-level2": "address-level2",
  "address-level3": "address-level3",
  "postal-code": "postal-code",
  country: "country",
  "country-name": "country-name",
};

const SKIPPED_TYPES = new Set([
  "hidden",
  "password",
  "checkbox",
  "radio",
  "submit",
  "button",
  "reset",
  "file",
  "image",
  "range",
  "color",
  "date",
  "datetime-local",
  "time",
  "week",
  "search",
]);

const EXCLUDED =
  /\b(search|captcha|coupon|promo|discount|voucher|gift ?card|username|user ?name|login|password|otp|one time|ma giam gia|tim kiem|ten dang nhap)\b/;

const EXPIRY =
  /\b(exp|expiry|expiration|expires?|expdate|cc ?exp|valid (thru|through|until)|het han|han su dung|han the|thoi han|mm yy|mm yyyy)\b/;
const EXPIRY_BOTH = /\b(mm yy|mm yyyy|mm aa|month year|thang nam)\b/;
const MONTH = /\b(month|mm|mo|thang)\b/;
const YEAR = /\b(year|yy|yyyy|yr|nam)\b/;

const CARD_RULES: readonly (readonly [CardFieldKind, RegExp])[] = [
  [
    "cc-csc",
    /\b(cvv2?|cvc2?|csc|cvn|security ?code|card ?code|card verification|verification (code|number|value)|ma bao mat|ma cvv|ma xac minh the)\b/,
  ],
  [
    "cc-name",
    /\b(name on (the )?(credit |debit )?card|card ?holder( name)?|holder ?name|cc ?name|card ?name|nameoncard|ten (chu|tren) the|chu the|ten in tren the)\b/,
  ],
  ["cc-type", /\b(card ?(type|brand)|loai the)\b/],
  [
    "cc-number",
    /\b(card ?(number|no|num|nr)|cc ?(number|num|no)|credit ?card|debit ?card|cardnum\w*|ccnum\w*|so the)\b/,
  ],
];

const ADDRESS_RULES: readonly (readonly [AddressFieldKind, RegExp])[] = [
  ["email", /\b(e ?mail|thu dien tu)\b/],
  ["tel", /\b(phone|telephone|tel|mobile|cell|so dien thoai|dien thoai|sdt|so di dong|di dong)\b/],
  [
    "postal-code",
    /\b(zip|zip ?code|zipcode|postal|post ?code|postcode|ma buu chinh|ma buu dien)\b/,
  ],
  ["country-name", /\b(country|quoc gia)\b/],
  ["organization", /\b(company|organi[sz]ation|business ?name|cong ty|to chuc)\b/],
  ["address-level3", /\b(ward|commune|phuong|xa)\b/],
  ["address-level1", /\b(tinh|thanh pho|province|state|region|county|prefecture)\b/],
  ["address-level2", /\b(city|town|locality|suburb|district|quan|huyen)\b/],
  [
    "address-line2",
    /\b(address ?(line)? ?2|addr ?2|line ?2|apartment|apt|suite|unit|dia chi 2|can ho|toa nha)\b/,
  ],
  [
    "address-line1",
    /\b(address ?(line)? ?1|addr ?1|line ?1|street|address|addr|dia chi|so nha|duong)\b/,
  ],
  ["name", /\b(ho (va )?ten|full ?name|fullname|your name|ten day du)\b/],
  ["given-name", /\b(first ?name|given ?name|fname|forename|ten)\b/],
  ["family-name", /\b(last ?name|surname|family ?name|lname|ho)\b/],
  ["name", /\b(name|recipient|nguoi nhan)\b/],
];

const PLACE_KINDS = new Set<FormFieldKind>([
  "street-address",
  "address-line1",
  "address-level1",
  "address-level2",
  "address-level3",
  "postal-code",
  "country",
  "country-name",
]);

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

export function isCardKind(kind: FormFieldKind): kind is CardFieldKind {
  return kind.startsWith("cc-");
}

function isFillable(element: FormField): boolean {
  if (element.disabled) return false;
  if (element instanceof HTMLInputElement) {
    if (element.readOnly || SKIPPED_TYPES.has(element.type)) return false;
  }
  if (element instanceof HTMLTextAreaElement && element.readOnly) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function autocompleteKind(element: FormField): FormFieldKind | null {
  const tokens = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  for (const token of tokens.reverse()) {
    const kind = TOKENS[token];
    if (kind) return kind;
  }
  return null;
}

function labelText(element: FormField): string {
  const labels = [...(element.labels ?? [])].map((label) => label.textContent ?? "");
  const wrapping = element.closest("label");
  if (wrapping && labels.length === 0) labels.push(wrapping.textContent ?? "");
  for (const id of (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)) {
    if (id) labels.push(element.ownerDocument.getElementById(id)?.textContent ?? "");
  }
  if (labels.length === 0) {
    const previous = element.previousElementSibling;
    const labelsOther =
      previous instanceof HTMLLabelElement &&
      (previous.htmlFor !== "" || previous.querySelector("input, select, textarea") !== null);
    const text =
      previous && !labelsOther && !previous.matches("input, select, textarea")
        ? previous.textContent
        : "";
    if (text && text.trim().length <= 40) labels.push(text);
  }
  return labels.join(" ");
}

function rawDescription(element: FormField): string {
  return [
    element.name,
    element.id,
    "placeholder" in element ? element.placeholder : "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
    element.getAttribute("data-testid") ?? "",
    labelText(element),
  ].join(" ");
}

export function describeField(element: FormField): string {
  return foldText(rawDescription(element).replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function optionShape(select: HTMLSelectElement): "month" | "year" | null {
  const numbers = [...select.options]
    .map((option) => Number(option.value.trim() || option.text.trim()))
    .filter((value) => Number.isInteger(value));
  if (numbers.length < 3) return null;
  if (numbers.every((value) => value >= 1 && value <= 12) && numbers.length <= 13) return "month";
  if (numbers.every((value) => (value >= 2000 && value <= 2100) || (value >= 0 && value <= 99))) {
    return "year";
  }
  return null;
}

function expiryKind(text: string): CardFieldKind {
  if (EXPIRY_BOTH.test(text)) return "cc-exp";
  if (MONTH.test(text)) return "cc-exp-month";
  if (YEAR.test(text)) return "cc-exp-year";
  return "cc-exp";
}

export function classifyField(element: FormField, cardContext = false): FormFieldKind | null {
  if (!isFillable(element)) return null;
  const token = autocompleteKind(element);
  if (token) return token;
  const text = describeField(element);
  if (EXCLUDED.test(text)) return null;
  for (const [kind, pattern] of CARD_RULES) if (pattern.test(text)) return kind;
  if (EXPIRY.test(text)) return expiryKind(text);
  if (cardContext) {
    if (EXPIRY_BOTH.test(text)) return "cc-exp";
    if (MONTH.test(text)) return "cc-exp-month";
    if (YEAR.test(text)) return "cc-exp-year";
    if (element instanceof HTMLSelectElement) {
      const shape = optionShape(element);
      if (shape) return shape === "month" ? "cc-exp-month" : "cc-exp-year";
    }
  }
  for (const [kind, pattern] of ADDRESS_RULES) {
    if (!pattern.test(text)) continue;
    if (kind === "address-line1" && element instanceof HTMLTextAreaElement) return "street-address";
    return kind;
  }
  if (element instanceof HTMLInputElement && element.type === "email") return "email";
  if (element instanceof HTMLInputElement && element.type === "tel") return "tel";
  return null;
}

export function detectFields(scope: ParentNode): DetectedField[] {
  const elements = [...scope.querySelectorAll<FormField>("input, select, textarea")];
  const first = elements.map((element) => classifyField(element));
  const cardContext = first.includes("cc-number");
  return elements.flatMap((element, index) => {
    const kind = first[index] ?? (cardContext ? classifyField(element, true) : null);
    return kind ? [{ element, kind }] : [];
  });
}

export function formKindOf(element: FormField, fields: DetectedField[]): FormKind | null {
  const own = fields.find((field) => field.element === element);
  if (!own) return null;
  if (isCardKind(own.kind)) {
    return fields.some((field) => field.kind === "cc-number") ? "card" : null;
  }
  const kinds = new Set(fields.map((field) => field.kind).filter((kind) => !isCardKind(kind)));
  const places = [...kinds].filter((kind) => PLACE_KINDS.has(kind));
  return kinds.size >= 3 && places.length > 0 ? "address" : null;
}

export function setFieldValue(element: FormField, value: string): void {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  element.focus();
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function options(select: HTMLSelectElement): HTMLOptionElement[] {
  return [...select.options].filter((option) => !option.disabled);
}

export function chooseOption(select: HTMLSelectElement, wanted: string[]): string | null {
  const targets = [...new Set(wanted.map(foldText).filter(Boolean))];
  if (targets.length === 0) return null;
  const choices = options(select).map((option) => ({
    option,
    keys: [foldText(option.value), foldText(option.text)].filter(Boolean),
  }));
  const exact = choices.find((choice) => choice.keys.some((key) => targets.includes(key)));
  if (exact) return exact.option.value;
  const loose = choices.find((choice) =>
    choice.keys.some((key) => targets.some((target) => bareRegion(key) === bareRegion(target))),
  );
  if (loose) return loose.option.value;
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
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return null;
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

function selectOrText(element: FormField, value: string | undefined, wanted?: string[]) {
  if (!value) return null;
  if (element instanceof HTMLSelectElement) return chooseOption(element, wanted ?? [value]);
  return value;
}

export function splitName(
  fullName: string | undefined,
  country?: string,
): { given: string; family: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { given: parts[0] ?? "", family: "" };
  if (countryOf(country)?.code === "VN") {
    return { given: parts.slice(1).join(" "), family: parts[0]! };
  }
  return { given: parts.slice(0, -1).join(" "), family: parts.at(-1)! };
}

function cardValue(field: DetectedField, card: CardData): string | null {
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
      if (!expiry) return null;
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

export function fillCard(fields: DetectedField[], card: CardData, set: Setter): number {
  let filled = 0;
  for (const field of fields) {
    if (!isCardKind(field.kind)) continue;
    const value = cardValue(field, card);
    if (value === null || value === "") continue;
    set(field.element, value);
    filled++;
  }
  return filled;
}

function streetLines(data: AddressData, fields: DetectedField[]): [string[], string[]] {
  const lines = (data.address ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasWardField = fields.some((field) => field.kind === "address-level3");
  const rest = lines.slice(1);
  if (data.ward && !hasWardField) rest.push(data.ward);
  return [lines.slice(0, 1), rest];
}

function countryValue(field: DetectedField, data: AddressData): string | null {
  const country = countryOf(data.country);
  const { element } = field;
  if (element instanceof HTMLSelectElement) {
    return chooseOption(element, country ? [country.code, ...country.names] : [data.country ?? ""]);
  }
  if (!country) return data.country ?? null;
  const wantsCode = field.kind === "country" || (element.maxLength > 0 && element.maxLength <= 3);
  return wantsCode ? country.code : (country.names[0] ?? null);
}

function regionValue(element: FormField, region: string | undefined): string | null {
  if (!region) return null;
  if (element instanceof HTMLSelectElement) return chooseOption(element, regionNames(region));
  const state = US_STATES.find(([code, name]) => code === region || name === region);
  if (state && element.maxLength === 2) return state[0];
  return region;
}

function addressValue(
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
      return selectOrText(element, data.phone);
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

export function fillAddress(fields: DetectedField[], data: AddressData, set: Setter): number {
  let filled = 0;
  const ordered = [...fields].sort(
    (a, b) => Number(b.kind.startsWith("country")) - Number(a.kind.startsWith("country")),
  );
  for (const field of ordered) {
    if (isCardKind(field.kind)) continue;
    const value = addressValue(field, data, fields);
    if (value === null || value === "") continue;
    set(field.element, value);
    filled++;
  }
  return filled;
}

export function countryHint(fields: DetectedField[], hostname: string, lang: string): "US" | "VN" {
  for (const field of fields) {
    if (!field.kind.startsWith("country")) continue;
    const code = countryOf(field.element.value)?.code;
    if (code === "VN" || code === "US") return code;
  }
  return hostname.endsWith(".vn") || lang.toLowerCase().startsWith("vi") ? "VN" : "US";
}
