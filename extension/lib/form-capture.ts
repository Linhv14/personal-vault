import { countryOf, foldText } from "../../src/core/address-data.js";
import type { AddressData, CapturedCard } from "./autofill-protocol.js";
import { cardDigits, itemType, normalizeExpiry } from "./item-types.js";
import { registrableDomain } from "../../src/core/site.js";
import { itemSites, type VaultItem } from "./vault.js";

export interface CleanCard {
  number: string;
  expiry?: string;
  cardholder?: string;
  cvv?: string;
}

export type Match<T> = { status: "new" } | { status: "same" } | { status: "changed"; item: T };

const ADDRESS_KEYS = [
  "fullName",
  "email",
  "phone",
  "company",
  "address",
  "ward",
  "city",
  "region",
  "postalCode",
  "country",
] as const;

export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function cleanExpiry(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) {
    return undefined;
  }
  const compact = /^(\d{2})(\d{2}|\d{4})$/.exec(text.replace(/\s+/g, ""));
  const candidate = compact ? `${compact[1]}/${compact[2]}` : text;
  return normalizeExpiry(candidate) ?? undefined;
}

export function mergeCards(parts: (CapturedCard | undefined)[]): CapturedCard {
  const merged: CapturedCard = {};
  for (const part of parts) {
    if (!part) {
      continue;
    }
    for (const key of ["cardholder", "number", "expiry", "cvv"] as const) {
      const value = part[key]?.trim();
      if (value) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

export function cleanCard(card: CapturedCard): CleanCard | null {
  const number = cardDigits(card.number);
  if (!luhnValid(number)) {
    return null;
  }
  const expiry = cleanExpiry(card.expiry);
  const cardholder = card.cardholder?.trim().replace(/\s+/g, " ");
  const cvv = card.cvv?.trim();
  return {
    number,
    ...(expiry ? { expiry } : {}),
    ...(cardholder ? { cardholder } : {}),
    ...(cvv && /^\d{3,4}$/.test(cvv) ? { cvv } : {}),
  };
}

export function matchCard(items: VaultItem[], card: CleanCard): Match<VaultItem> {
  const existing = items.find(
    (item) => itemType(item) === "card" && cardDigits(item.cardNumber) === card.number,
  );
  if (!existing) {
    return { status: "new" };
  }
  const storedExpiry = existing.cardExpiry ? normalizeExpiry(existing.cardExpiry) : null;
  const newExpiry = card.expiry !== undefined && card.expiry !== storedExpiry;
  const newHolder =
    card.cardholder !== undefined &&
    foldText(card.cardholder) !== foldText(existing.cardholder ?? "");
  return newExpiry || newHolder ? { status: "changed", item: existing } : { status: "same" };
}

export function cleanAddress(data: AddressData): AddressData {
  const clean: AddressData = {};
  for (const key of ADDRESS_KEYS) {
    const value = data[key]
      ?.split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .join("\n");
    if (value) {
      clean[key] = value;
    }
  }
  return clean;
}

export function addressWorthSaving(data: AddressData, random = false): boolean {
  const filled = ADDRESS_KEYS.filter((key) => data[key]).length;
  if (random) {
    return filled >= 2;
  }
  if (data.address && (data.city || data.fullName || data.postalCode)) {
    return true;
  }
  return Boolean(data.fullName && (data.email || data.phone));
}

const phoneKey = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "").slice(-9);
const emailKey = (email: string | undefined) => (email ?? "").trim().toLowerCase();
const textKey = (text: string | undefined) => foldText(text ?? "");
const streetKey = (address: string | undefined) => textKey(address?.split("\n")[0]);

function sameValue(key: (typeof ADDRESS_KEYS)[number], a: string | undefined, b: string) {
  if (key === "phone") {
    return phoneKey(a) === phoneKey(b);
  }
  if (key === "email") {
    return emailKey(a) === emailKey(b);
  }
  if (key === "country") {
    const left = countryOf(a)?.code;
    const right = countryOf(b)?.code;
    if (left && right) {
      return left === right;
    }
  }
  return textKey(a) === textKey(b);
}

function sameIdentity(item: VaultItem, data: AddressData): boolean {
  if (data.fullName && data.address && item.fullName && item.address) {
    if (
      textKey(item.fullName) === textKey(data.fullName) &&
      streetKey(item.address) === streetKey(data.address)
    ) {
      return true;
    }
  }
  if (data.email && data.phone && item.email && item.phone) {
    if (
      emailKey(item.email) === emailKey(data.email) &&
      phoneKey(item.phone) === phoneKey(data.phone)
    ) {
      return true;
    }
  }
  if (data.address) {
    return false;
  }
  return (
    (Boolean(data.email) && !data.phone && emailKey(item.email) === emailKey(data.email)) ||
    (Boolean(data.phone) && !data.email && phoneKey(item.phone) === phoneKey(data.phone))
  );
}

export function matchIdentity(items: VaultItem[], data: AddressData): Match<VaultItem> {
  const existing = items.find((item) => itemType(item) === "identity" && sameIdentity(item, data));
  if (!existing) {
    return { status: "new" };
  }
  const changed = ADDRESS_KEYS.some((key) => {
    const value = data[key];
    return value !== undefined && !sameValue(key, existing[key], value);
  });
  return changed ? { status: "changed", item: existing } : { status: "same" };
}

export function withAddress(item: VaultItem, data: AddressData): VaultItem {
  const next = { ...item };
  for (const key of ADDRESS_KEYS) {
    const value = data[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

export function addressPreview(data: AddressData): string {
  const street = data.address?.split("\n")[0];
  return [data.fullName, street, data.city ?? data.region, !street ? data.email : undefined]
    .filter(Boolean)
    .join(" · ");
}

export function boundToSite(item: Pick<VaultItem, "url" | "urls">, domain: string): boolean {
  return itemSites(item).some((site) => registrableDomain(site) === domain);
}
