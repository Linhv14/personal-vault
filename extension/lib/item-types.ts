import type { MessageKey } from "../../src/i18n/index.js";
import type { IconName } from "../../src/ui/icons.js";
import type { VaultItem } from "./vault.js";

export const ITEM_TYPES = [
  "login",
  "note",
  "card",
  "identity",
  "recovery",
  "wifi",
  "api",
  "ssh",
  "bank",
  "document",
  "license",
] as const;
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
  | "multilineSecret"
  | "codes"
  | "cardNumber"
  | "expiry";

type TextKey = {
  [K in keyof VaultItem]-?: NonNullable<VaultItem[K]> extends string ? K : never;
}[keyof VaultItem];

export type TextFieldKey = Exclude<
  TextKey,
  "id" | "title" | "type" | "urlMatch" | "vault" | "system"
>;
export type FieldKey = TextFieldKey | "totp" | "codes";

export interface FieldSpec {
  key: FieldKey;
  label: MessageKey;
  kind: FieldKind;
}

export interface CustomField {
  label: string;
  value: string;
  hidden?: boolean;
}

export interface PasswordChange {
  password: string;
  changedAt: number;
}

export const PASSWORD_HISTORY_LIMIT = 10;

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
  api: [
    { key: "url", label: "field.api_host", kind: "url" },
    { key: "username", label: "field.key_id", kind: "text" },
    { key: "password", label: "field.api_secret", kind: "secret" },
    { key: "expiresOn", label: "field.expires_on", kind: "text" },
    NOTE,
  ],
  ssh: [
    { key: "sshPublicKey", label: "field.public_key", kind: "multiline" },
    { key: "sshFingerprint", label: "field.fingerprint", kind: "text" },
    { key: "sshPrivateKey", label: "field.private_key", kind: "multilineSecret" },
    { key: "password", label: "field.passphrase", kind: "secret" },
    NOTE,
  ],
  bank: [
    { key: "bankName", label: "field.bank_name", kind: "text" },
    { key: "fullName", label: "field.account_holder", kind: "text" },
    { key: "accountNumber", label: "field.account_number", kind: "text" },
    { key: "routingNumber", label: "field.routing_number", kind: "text" },
    { key: "swift", label: "field.swift", kind: "text" },
    { key: "iban", label: "field.iban", kind: "text" },
    { key: "pin", label: "field.card_pin", kind: "secret" },
    NOTE,
  ],
  document: [
    { key: "documentKind", label: "field.document_kind", kind: "text" },
    { key: "fullName", label: "field.full_name", kind: "text" },
    { key: "documentNumber", label: "field.document_number", kind: "text" },
    { key: "issuedOn", label: "field.issued_on", kind: "text" },
    { key: "expiresOn", label: "field.expires_on", kind: "text" },
    { key: "issuer", label: "field.issuer", kind: "text" },
    { key: "country", label: "field.country", kind: "text" },
    NOTE,
  ],
  license: [
    { key: "licenseKey", label: "field.license_key", kind: "secret" },
    { key: "version", label: "field.version", kind: "text" },
    { key: "fullName", label: "field.licensed_to", kind: "text" },
    { key: "email", label: "field.email", kind: "email" },
    { key: "expiresOn", label: "field.expires_on", kind: "text" },
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
  api: "type.api",
  ssh: "type.ssh",
  bank: "type.bank",
  document: "type.document",
  license: "type.license",
};

export const KIND_LABEL: Record<ItemType, MessageKey> = {
  login: "kind.login",
  note: "kind.note",
  card: "kind.card",
  identity: "kind.identity",
  recovery: "kind.recovery",
  wifi: "kind.wifi",
  api: "kind.api",
  ssh: "kind.ssh",
  bank: "kind.bank",
  document: "kind.document",
  license: "kind.license",
};

export const NEW_LABEL: Record<ItemType, MessageKey> = {
  login: "new.login",
  note: "new.note",
  card: "new.card",
  identity: "new.identity",
  recovery: "new.recovery",
  wifi: "new.wifi",
  api: "new.api",
  ssh: "new.ssh",
  bank: "new.bank",
  document: "new.document",
  license: "new.license",
};

export const TYPE_ICON: Record<ItemType, IconName> = {
  login: "key",
  note: "note",
  card: "card",
  identity: "person",
  recovery: "life-buoy",
  wifi: "wifi",
  api: "braces",
  ssh: "terminal",
  bank: "bank",
  document: "id-card",
  license: "badge",
};

export const HAS_PASSWORD_HISTORY: ReadonlySet<ItemType> = new Set(["login", "wifi", "api"]);

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

export function unusedCodes(item: Pick<VaultItem, "codes" | "usedCodes">): string[] {
  const used = new Set(item.usedCodes ?? []);
  return (item.codes ?? []).filter((code) => !used.has(code));
}

export function keepUsedCodes(codes: string[] | undefined, used: string[] | undefined) {
  const kept = (used ?? []).filter((code) => codes?.includes(code));
  return kept.length > 0 ? kept : undefined;
}

export function toggleUsedCode(
  item: Pick<VaultItem, "codes" | "usedCodes">,
  code: string,
): string[] | undefined {
  const used = new Set(item.usedCodes ?? []);
  if (used.has(code)) used.delete(code);
  else used.add(code);
  return keepUsedCodes(item.codes, [...used]);
}

export function withPasswordHistory(
  previous: Pick<VaultItem, "password" | "passwordHistory"> | null,
  nextPassword: string | undefined,
  now: number,
): PasswordChange[] | undefined {
  const history = previous?.passwordHistory ?? [];
  const old = previous?.password;
  if (!old || old === nextPassword) return history.length > 0 ? history : undefined;
  return [{ password: old, changedAt: now }, ...history].slice(0, PASSWORD_HISTORY_LIMIT);
}

export function cleanCustomFields(fields: CustomField[]): CustomField[] | undefined {
  const kept = fields
    .map((field) => ({ ...field, label: field.label.trim() }))
    .filter((field) => field.label || field.value)
    .map(({ label, value, hidden }) => (hidden ? { label, value, hidden } : { label, value }));
  return kept.length > 0 ? kept : undefined;
}

export function cleanUrls(urls: string[]): string[] | undefined {
  const kept = urls.map((url) => url.trim()).filter(Boolean);
  return kept.length > 0 ? [...new Set(kept)] : undefined;
}

function typeText(item: VaultItem): (string | undefined)[] {
  switch (itemType(item)) {
    case "login":
      return [item.username, item.url, ...(item.urls ?? []), item.totp?.issuer];
    case "card":
      return [item.cardholder, lastFour(item.cardNumber)];
    case "identity":
      return [item.fullName, item.email, item.phone, item.company, item.city];
    case "wifi":
      return [item.ssid];
    case "api":
      return [item.url, item.username];
    case "ssh":
      return [item.sshFingerprint];
    case "bank":
      return [item.bankName, item.fullName];
    case "document":
      return [item.documentKind, item.fullName];
    case "license":
      return [item.version, item.fullName, item.email];
    case "note":
    case "recovery":
      return [];
  }
}

export function searchableText(item: VaultItem): string[] {
  const custom = (item.fields ?? []).flatMap((field) =>
    field.hidden ? [field.label] : [field.label, field.value],
  );
  return [item.title, ...(item.tags ?? []), ...typeText(item), ...custom].filter(present);
}

function present(value: string | undefined): value is string {
  return Boolean(value);
}
