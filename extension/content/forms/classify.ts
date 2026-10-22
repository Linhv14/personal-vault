import { foldText } from "#core/address-data.js";

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
export type FormKind = "card" | "address" | "profile";

export interface DetectedField {
  element: FormField;
  kind: FormFieldKind;
}

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

const PROFILE_KINDS = new Set<FormFieldKind>(["name", "given-name", "family-name", "email", "tel"]);

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

export function isCardKind(kind: FormFieldKind): kind is CardFieldKind {
  return kind.startsWith("cc-");
}

function isFillable(element: FormField): boolean {
  if (element.disabled) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    if (element.readOnly || SKIPPED_TYPES.has(element.type)) {
      return false;
    }
  }
  if (element instanceof HTMLTextAreaElement && element.readOnly) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function autocompleteKind(element: FormField): FormFieldKind | null {
  const tokens = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  for (const token of tokens.reverse()) {
    const kind = TOKENS[token];
    if (kind) {
      return kind;
    }
  }
  return null;
}

function labelText(element: FormField): string {
  const labels = [...(element.labels ?? [])].map((label) => label.textContent ?? "");
  const wrapping = element.closest("label");
  if (wrapping && labels.length === 0) {
    labels.push(wrapping.textContent ?? "");
  }
  for (const id of (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)) {
    if (id) {
      labels.push(element.ownerDocument.getElementById(id)?.textContent ?? "");
    }
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
    if (text && text.trim().length <= 40) {
      labels.push(text);
    }
  }
  return labels.join(" ");
}

export function rawDescription(element: FormField): string {
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
  if (numbers.length < 3) {
    return null;
  }
  if (numbers.every((value) => value >= 1 && value <= 12) && numbers.length <= 13) {
    return "month";
  }
  if (numbers.every((value) => (value >= 2000 && value <= 2100) || (value >= 0 && value <= 99))) {
    return "year";
  }
  return null;
}

function expiryKind(text: string): CardFieldKind {
  if (EXPIRY_BOTH.test(text)) {
    return "cc-exp";
  }
  if (MONTH.test(text)) {
    return "cc-exp-month";
  }
  if (YEAR.test(text)) {
    return "cc-exp-year";
  }
  return "cc-exp";
}

export function classifyField(element: FormField, cardContext = false): FormFieldKind | null {
  if (!isFillable(element)) {
    return null;
  }
  const token = autocompleteKind(element);
  if (token) {
    return token;
  }
  const text = describeField(element);
  if (EXCLUDED.test(text)) {
    return null;
  }
  for (const [kind, pattern] of CARD_RULES) {
    if (pattern.test(text)) {
      return kind;
    }
  }
  if (EXPIRY.test(text)) {
    return expiryKind(text);
  }
  if (cardContext) {
    if (EXPIRY_BOTH.test(text)) {
      return "cc-exp";
    }
    if (MONTH.test(text)) {
      return "cc-exp-month";
    }
    if (YEAR.test(text)) {
      return "cc-exp-year";
    }
    if (element instanceof HTMLSelectElement) {
      const shape = optionShape(element);
      if (shape) {
        return shape === "month" ? "cc-exp-month" : "cc-exp-year";
      }
    }
  }
  for (const [kind, pattern] of ADDRESS_RULES) {
    if (!pattern.test(text)) {
      continue;
    }
    if (kind === "address-line1" && element instanceof HTMLTextAreaElement) {
      return "street-address";
    }
    return kind;
  }
  if (element instanceof HTMLInputElement && element.type === "email") {
    return "email";
  }
  if (element instanceof HTMLInputElement && element.type === "tel") {
    return "tel";
  }
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
  if (!own) {
    return null;
  }
  if (isCardKind(own.kind)) {
    return fields.some((field) => field.kind === "cc-number") ? "card" : null;
  }
  const kinds = new Set(fields.map((field) => field.kind).filter((kind) => !isCardKind(kind)));
  const places = [...kinds].filter((kind) => PLACE_KINDS.has(kind));
  if (kinds.size >= 3 && places.length > 0) {
    return "address";
  }
  const profile = [...kinds].filter((kind) => PROFILE_KINDS.has(kind));
  return profile.length >= 2 && profile.some((kind) => kind !== "email") ? "profile" : null;
}
