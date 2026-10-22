import type { TotpConfig } from "#core/totp.js";
import type { StoredPasskey } from "../passkey/authenticator.js";

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

export interface CustomField {
  label: string;
  value: string;
  hidden?: boolean;
}

export interface PasswordChange {
  password: string;
  changedAt: number;
}

export interface VaultDef {
  id: string;
  name: string;
  color: string;
  icon: string;
  shared?: { orgName: string; rekeyNeeded: boolean; viewOnly?: boolean };
}

export interface VaultItem {
  id: string;
  type?: ItemType;
  vault?: string;
  system?: "vaults";
  vaults?: VaultDef[];
  favorite?: boolean;
  tags?: string[];
  trashedAt?: number;
  title: string;
  url?: string;
  username?: string;
  password?: string;
  totp?: TotpConfig;
  note?: string;
  passkey?: StoredPasskey;
  cardholder?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardPin?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  ward?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  codes?: string[];
  usedCodes?: string[];
  ssid?: string;
  urls?: string[];
  urlMatch?: "domain" | "host";
  fields?: CustomField[];
  passwordHistory?: PasswordChange[];
  lastUsedAt?: number;
  editedAt?: number;
  expiresOn?: string;
  sshPublicKey?: string;
  sshPrivateKey?: string;
  sshFingerprint?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  swift?: string;
  iban?: string;
  pin?: string;
  documentKind?: string;
  documentNumber?: string;
  issuedOn?: string;
  issuer?: string;
  licenseKey?: string;
  version?: string;
  createdAt: number;
  updatedAt: number;
}

export type ItemDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { createdAt?: number };
