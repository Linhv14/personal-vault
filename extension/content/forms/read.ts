import { countryOf } from "#core/address-data.js";
import type { AddressData, CapturedCard } from "#ext/lib/autofill-protocol.js";
import { isCardKind, type DetectedField, type FormField } from "./classify.js";

export interface FilledValue {
  value: string;
  random: boolean;
}

export type FilledFields = WeakMap<FormField, FilledValue>;

const SUBMIT_TEXT =
  /\b(pay|place order|order|checkout|check out|continue|next|save|submit|confirm|complete|finish|purchase|buy|proceed|ship|deliver|update|add card|add address)\b|thanh toán|đặt hàng|tiếp tục|lưu|xác nhận|hoàn tất|mua|cập nhật|gửi/i;
const NOT_SUBMIT =
  /coupon|promo|discount|voucher|gift|apply|remove|delete|cancel|back|close|edit|search|giảm giá|áp dụng|xoá|xóa|hủy|huỷ|quay lại|đóng|sửa|tìm/i;

function valueOf(element: FormField): string {
  if (element instanceof HTMLSelectElement) {
    const option = element.selectedOptions[0];
    if (!option || !option.value.trim()) {
      return "";
    }
    return (option.text || option.value).trim();
  }
  return element.value.trim();
}

function first(fields: DetectedField[], ...kinds: string[]): string | undefined {
  for (const kind of kinds) {
    const value = fields.find((field) => field.kind === kind && valueOf(field.element))?.element;
    if (value) {
      return valueOf(value);
    }
  }
  return undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthOf(element: FormField): number | null {
  const raw =
    element instanceof HTMLSelectElement ? element.value || valueOf(element) : element.value;
  const digits = /\d{1,2}/.exec(raw)?.[0];
  if (digits) {
    return Number(digits);
  }
  const index = MONTHS.findIndex((name) => raw.trim().toLowerCase().startsWith(name));
  return index >= 0 ? index + 1 : null;
}

function yearOf(element: FormField): string | null {
  const raw =
    element instanceof HTMLSelectElement ? element.value || valueOf(element) : element.value;
  return /\d{4}|\d{2}/.exec(raw)?.[0] ?? null;
}

function expiryOf(fields: DetectedField[]): string | undefined {
  const combined = first(fields, "cc-exp");
  if (combined) {
    return combined;
  }
  const month = fields.find((field) => field.kind === "cc-exp-month")?.element;
  const year = fields.find((field) => field.kind === "cc-exp-year")?.element;
  if (!month || !year) {
    return undefined;
  }
  const mm = monthOf(month);
  const yy = yearOf(year);
  if (!mm || mm > 12 || !yy) {
    return undefined;
  }
  return `${String(mm).padStart(2, "0")}/${yy.slice(-2)}`;
}

export function readCard(fields: DetectedField[]): CapturedCard {
  const given = first(fields, "cc-given-name");
  const family = first(fields, "cc-family-name");
  const cardholder =
    first(fields, "cc-name") ?? ([given, family].filter(Boolean).join(" ") || undefined);
  const entries = {
    cardholder,
    number: first(fields, "cc-number")?.replace(/[\s-]/g, ""),
    expiry: expiryOf(fields),
    cvv: first(fields, "cc-csc"),
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
}

export function readAddress(fields: DetectedField[]): AddressData {
  const own = fields.filter((field) => !isCardKind(field.kind));
  const country = first(own, "country", "country-name");
  const given = first(own, "given-name");
  const family = first(own, "family-name");
  const vietnamese = countryOf(country)?.code === "VN";
  const joined = vietnamese
    ? [family, given].filter(Boolean).join(" ")
    : [given, family].filter(Boolean).join(" ");
  const street = first(own, "street-address", "address-line1");
  const line2 = first(own, "address-line2");
  const entries: AddressData = {
    fullName: first(own, "name") ?? (joined || undefined),
    email: first(own, "email"),
    phone: first(own, "tel"),
    company: first(own, "organization"),
    address: [street, line2].filter(Boolean).join("\n") || undefined,
    ward: first(own, "address-level3"),
    city: first(own, "address-level2"),
    region: first(own, "address-level1"),
    postalCode: first(own, "postal-code"),
    country,
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
}

export function fillState(
  fields: DetectedField[],
  filled: FilledFields,
): { typed: boolean; random: boolean } {
  let typed = false;
  let random = false;
  for (const { element } of fields) {
    const value = element.value;
    if (!value.trim()) {
      continue;
    }
    const ours = filled.get(element);
    if (!ours || ours.value !== value) {
      typed = true;
    } else if (ours.random) {
      random = true;
    }
  }
  return { typed, random };
}

export function isSubmitLike(button: Element): boolean {
  const text = [
    button.textContent ?? "",
    (button as HTMLInputElement).value ?? "",
    button.getAttribute("aria-label") ?? "",
  ]
    .join(" ")
    .trim();
  if (NOT_SUBMIT.test(text)) {
    return false;
  }
  const type = (button.getAttribute("type") ?? "").toLowerCase();
  if (button instanceof HTMLInputElement) {
    return type === "submit" || SUBMIT_TEXT.test(text);
  }
  if (button instanceof HTMLButtonElement && button.form && type !== "button") {
    return true;
  }
  return SUBMIT_TEXT.test(text);
}
