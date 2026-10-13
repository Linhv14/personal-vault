import type { MessageKey } from "../../src/i18n/index.js";
import type { IconName } from "../../src/ui/icons.js";
import type { VaultItem } from "./vault.js";

export const ITEM_TYPES = ["login", "note", "card", "identity", "recovery", "wifi"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "secret"
  | "password"
  | "totp"
  | "multiline"
  | "codes"
  | "cardNumber"
  | "expiry";

type TextKey = {
  [K in keyof VaultItem]-?: NonNullable<VaultItem[K]> extends string ? K : never;
}[keyof VaultItem];

export type TextFieldKey = Exclude<TextKey, "id" | "title" | "type">;
export type FieldKey = TextFieldKey | "totp" | "codes";

export interface FieldSpec {
  key: FieldKey;
  label: MessageKey;
  kind: FieldKind;
}

const NOTE: FieldSpec = { key: "note", label: "common.note", kind: "multiline" };

export const TYPE_FIELDS: Record<ItemType, FieldSpec[]> = {
  login: [
    { key: "url", label: "common.url", kind: "url" },
    { key: "username", label: "common.username", kind: "text" },
    { key: "password", label: "common.password", kind: "password" },
    { key: "totp", label: "edit.totp_secret", kind: "totp" },
    NOTE,
  ],
  note: [{ key: "note", label: "common.note", kind: "multiline" }],
  card: [
    { key: "cardholder", label: "field.cardholder", kind: "text" },
    { key: "cardNumber", label: "field.card_number", kind: "cardNumber" },
    { key: "cardExpiry", label: "field.card_expiry", kind: "expiry" },
    { key: "cardCvv", label: "field.card_cvv", kind: "secret" },
    { key: "cardPin", label: "field.card_pin", kind: "secret" },
    NOTE,
  ],
  identity: [
    { key: "fullName", label: "field.full_name", kind: "text" },
    { key: "email", label: "field.email", kind: "email" },
    { key: "phone", label: "field.phone", kind: "tel" },
    { key: "company", label: "field.company", kind: "text" },
    { key: "address", label: "field.address", kind: "multiline" },
    { key: "city", label: "field.city", kind: "text" },
    { key: "region", label: "field.region", kind: "text" },
    { key: "postalCode", label: "field.postal_code", kind: "text" },
    { key: "country", label: "field.country", kind: "text" },
    NOTE,
  ],
  recovery: [{ key: "codes", label: "field.codes", kind: "codes" }, NOTE],
  wifi: [
    { key: "ssid", label: "field.ssid", kind: "text" },
    { key: "password", label: "common.password", kind: "password" },
    NOTE,
  ],
};

export const TYPE_LABEL: Record<ItemType, MessageKey> = {
  login: "type.login",
  note: "type.note",
  card: "type.card",
  identity: "type.identity",
  recovery: "type.recovery",
  wifi: "type.wifi",
};

export const KIND_LABEL: Record<ItemType, MessageKey> = {
  login: "kind.login",
  note: "kind.note",
  card: "kind.card",
  identity: "kind.identity",
  recovery: "kind.recovery",
  wifi: "kind.wifi",
};

export const NEW_LABEL: Record<ItemType, MessageKey> = {
  login: "new.login",
  note: "new.note",
  card: "new.card",
  identity: "new.identity",
  recovery: "new.recovery",
  wifi: "new.wifi",
};

export const TYPE_ICON: Record<ItemType, IconName> = {
  login: "key",
  note: "note",
  card: "card",
  identity: "person",
  recovery: "life-buoy",
  wifi: "wifi",
};

type TypeEvidence = Partial<
  Pick<VaultItem, "type" | "url" | "username" | "password" | "totp" | "passkey" | "note">
>;

export function itemType(item: TypeEvidence): ItemType {
  if (item.type) return item.type;
  const loginFields = item.url || item.username || item.password || item.totp || item.passkey;
  return !loginFields && item.note ? "note" : "login";
}

export function cardDigits(number: string | undefined): string {
  return (number ?? "").replace(/\D/g, "");
}

export function formatCardNumber(number: string): string {
  return cardDigits(number).replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function lastFour(number: string | undefined): string {
  return cardDigits(number).slice(-4);
}

export function normalizeExpiry(input: string): string | null {
  const match = /^\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})\s*$/.exec(input);
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return null;
  return `${String(month).padStart(2, "0")}/${match[2].slice(-2)}`;
}

export function searchableText(item: VaultItem): string[] {
  const base = [item.title];
  switch (itemType(item)) {
    case "login":
      return [...base, item.username, item.url, item.totp?.issuer].filter(present);
    case "card":
      return [...base, item.cardholder, lastFour(item.cardNumber)].filter(present);
    case "identity":
      return [...base, item.fullName, item.email, item.phone, item.company, item.city].filter(
        present,
      );
    case "wifi":
      return [...base, item.ssid].filter(present);
    case "note":
    case "recovery":
      return base;
  }
}

function present(value: string | undefined): value is string {
  return Boolean(value);
}
