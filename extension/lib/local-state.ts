import { isKdfParams, isSealedData } from "#core/crypto.js";
import { isWrappedForRecipient } from "#core/identity.js";
import {
  isBoolean,
  isFiniteNumber,
  isPlainObject,
  isPositiveInteger,
  isString,
  isStringArray,
} from "#core/json.js";
import type { LocalePreference } from "#i18n/index.js";
import type { CachedItem, CachedSharedVault, LocalState } from "./local-state-types.js";

type Guard<T> = (value: unknown) => value is T;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

const SAFE_AUTO_LOCK_MINUTES = 15;

function isAutoLock(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= -1;
}

function isLocale(value: unknown): value is LocalePreference {
  return value === "auto" || value === "en" || value === "vi";
}

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function isCachedItem(value: unknown): value is CachedItem {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    isNullableString(value.ciphertext) &&
    isNullableString(value.nonce) &&
    isFiniteNumber(value.updatedAt) &&
    (value.deletedAt === null || isFiniteNumber(value.deletedAt))
  );
}

function isSharedItem(value: unknown): value is CachedSharedVault["items"][number] {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    isSealedData(value.sealed) &&
    isFiniteNumber(value.updatedAt) &&
    typeof value.updatedBy === "string"
  );
}

function isSharedVault(value: unknown): value is CachedSharedVault {
  return (
    isPlainObject(value) &&
    typeof value.orgId === "string" &&
    typeof value.orgName === "string" &&
    typeof value.teamId === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.generation) &&
    typeof value.rekeyNeeded === "boolean" &&
    (value.viewOnly === undefined || typeof value.viewOnly === "boolean") &&
    isWrappedForRecipient(value.wrappedKey) &&
    Array.isArray(value.items) &&
    value.items.every(isSharedItem)
  );
}

function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

function shaped<T>(shape: { [K in keyof T]: Guard<T[K]> }): Guard<T> {
  return (value): value is T =>
    isPlainObject(value) &&
    Object.entries<Guard<unknown>>(shape).every(([key, guard]) => guard(value[key]));
}

function isGenerations(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isFiniteNumber);
}

const FIELDS: { [K in keyof LocalState]-?: Guard<NonNullable<LocalState[K]>> } = {
  apiUrl: isHttpUrl,
  email: isString,
  kdf: isKdfParams,
  wrappedVaultKey: isSealedData,
  items: arrayOf(isCachedItem),
  lastSync: isFiniteNumber,
  unboundItemsMigrated: isBoolean,
  aadBoundAccounts: isStringArray,
  autofillPromoDismissed: isBoolean,
  neverAskForms: isStringArray,
  sharedLinks: isSealedData,
  autoLockMinutes: isAutoLock,
  hasPasskeys: isBoolean,
  clockSkew: isFiniteNumber,
  locale: isLocale,
  showLogos: isBoolean,
  resume: shaped({ token: isString, sealed: isSealedData }),
  pin: shaped({
    token: isString,
    salt: isString,
    iterations: isPositiveInteger,
    sealed: isSealedData,
  }),
  biometric: shaped({
    token: isString,
    credentialId: isString,
    secret: isString,
    sealed: isSealedData,
  }),
  biometricPromoDismissed: isBoolean,
  identity: shaped({ publicKey: isString, wrappedPrivateKey: isSealedData }),
  sharedVaults: arrayOf(isSharedVault),
  sharedGenerations: isGenerations,
};

function itemCount(items: unknown): number {
  return Array.isArray(items) ? items.length : -1;
}

export function needsCacheRepair(raw: Record<string, unknown>, state: LocalState): boolean {
  return raw.lastSync !== undefined && state.lastSync === undefined;
}

export function normalizeLocalState(raw: Record<string, unknown>): LocalState {
  const state: Record<string, unknown> = {};
  for (const [key, guard] of Object.entries<Guard<unknown>>(FIELDS)) {
    const value = raw[key];
    if (value !== undefined && guard(value)) {
      state[key] = value;
    }
  }
  if (Array.isArray(raw.items) && state.items === undefined) {
    state.items = raw.items.filter(isCachedItem);
  }
  if (state.items === undefined || (state.items as unknown[]).length !== itemCount(raw.items)) {
    delete state.lastSync;
  }
  if (raw.autoLockMinutes !== undefined && state.autoLockMinutes === undefined) {
    state.autoLockMinutes = SAFE_AUTO_LOCK_MINUTES;
  }
  return state;
}
