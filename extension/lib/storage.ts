/**
 * Two storage areas, and the boundary between them is the extension's most
 * important security decision:
 *
 * - `chrome.storage.local` is ON DISK in the clear. Ciphertext and settings only.
 * - `chrome.storage.session` is in memory and cleared when the browser closes.
 *   The vault key and session token live here; see resume.ts for the disk copy.
 *
 * Mixing the two is a failure with no visible symptom: everything keeps working,
 * your keys are just sitting on disk.
 */

import type { KdfParams, SealedData } from "../../src/core/crypto.js";
import type { LocalePreference } from "../../src/i18n/index.js";

/** An item exactly as the server stores it — always ciphertext. */
export interface CachedItem {
  id: string;
  ciphertext: string | null;
  nonce: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LocalState {
  apiUrl?: string;
  email?: string;
  kdf?: KdfParams;
  /** Cached so the vault can be unlocked without a network connection. */
  wrappedVaultKey?: SealedData;
  items?: CachedItem[];
  lastSync?: number;
  unboundItemsMigrated?: boolean;
  autofillPromoDismissed?: boolean;
  sharedLinks?: SealedData;
  autoLockMinutes?: number;
  hasPasskeys?: boolean;
  /** Offset of this machine's clock against the server, in seconds. */
  clockSkew?: number;
  locale?: LocalePreference;
  showLogos?: boolean;
  resume?: { token: string; sealed: SealedData };
}

interface SessionState {
  vaultKeyRaw?: string; // base64
  token?: string;
  lockAt?: number; // epoch ms
  focusItem?: string;
}

export const LOCK_ON_BROWSER_CLOSE = 0;
export const LOCK_NEVER = -1;
export const DEFAULT_AUTO_LOCK_MINUTES = LOCK_NEVER;
export const AUTO_LOCK_CHOICES = [5, 15, 60, 240, LOCK_ON_BROWSER_CLOSE, LOCK_NEVER];

export async function autoLockMinutes(): Promise<number> {
  return (await getLocal()).autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
}

async function lockDeadline(): Promise<{ lockAt?: number }> {
  const minutes = await autoLockMinutes();
  return minutes > 0 ? { lockAt: Date.now() + minutes * 60_000 } : {};
}

export interface PendingSignup {
  apiUrl: string;
  email: string;
  registrationToken: string;
  sentAt: number;
}

const PENDING_SIGNUP_KEY = "pendingSignup";
const PENDING_SIGNUP_TTL_MS = 15 * 60_000;

export async function savePendingSignup(signup: PendingSignup): Promise<void> {
  await chrome.storage.session.set({ [PENDING_SIGNUP_KEY]: signup });
}

export async function loadPendingSignup(): Promise<PendingSignup | null> {
  const signup = (await chrome.storage.session.get(PENDING_SIGNUP_KEY))[PENDING_SIGNUP_KEY] as
    PendingSignup | undefined;
  if (!signup) return null;
  if (Date.now() - signup.sentAt > PENDING_SIGNUP_TTL_MS) {
    await clearPendingSignup();
    return null;
  }
  return signup;
}

export async function clearPendingSignup(): Promise<void> {
  await chrome.storage.session.remove(PENDING_SIGNUP_KEY);
}

export async function getLocal(): Promise<LocalState> {
  return (await chrome.storage.local.get(null)) as LocalState;
}

export async function setLocal(patch: Partial<LocalState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

const DEVICE_PREFERENCES = [
  "locale",
  "autoLockMinutes",
  "autofillPromoDismissed",
] as const satisfies readonly (keyof LocalState)[];

export async function clearAccountData(): Promise<void> {
  const local = await getLocal();
  const preferences = Object.fromEntries(
    DEVICE_PREFERENCES.filter((key) => local[key] !== undefined).map((key) => [key, local[key]]),
  );
  await chrome.storage.local.clear();
  await chrome.storage.local.set(preferences);
}

async function getSession(): Promise<SessionState> {
  return (await chrome.storage.session.get(null)) as SessionState;
}

export async function getUnlocked(): Promise<{ vaultKeyRaw: string; token?: string } | null> {
  const session = await getSession();
  if (!session.vaultKeyRaw) return null;

  // Check the deadline here rather than trusting the alarm alone: MV3 can kill
  // the service worker and delay alarms, but the popup must always be right.
  if (session.lockAt && Date.now() > session.lockAt) {
    await lock();
    return null;
  }
  return { vaultKeyRaw: session.vaultKeyRaw, token: session.token };
}

export async function unlock(vaultKeyRaw: string, token: string | undefined): Promise<void> {
  await chrome.storage.session.remove("lockAt");
  await chrome.storage.session.set({ vaultKeyRaw, token, ...(await lockDeadline()) });
  await scheduleLockAlarm();
}

/** Extend the deadline on activity so the vault never locks mid-use. */
export async function requestItemFocus(id: string): Promise<void> {
  await chrome.storage.session.set({ focusItem: id });
}

export async function takeItemFocus(): Promise<string | undefined> {
  const { focusItem } = await getSession();
  if (focusItem) await chrome.storage.session.remove("focusItem");
  return focusItem;
}

export async function touch(): Promise<void> {
  const session = await getSession();
  if (!session.vaultKeyRaw) return;
  const deadline = await lockDeadline();
  if (deadline.lockAt) await chrome.storage.session.set(deadline);
  else await chrome.storage.session.remove("lockAt");
}

export async function notePasskeys(present: boolean): Promise<void> {
  await setLocal({ hasPasskeys: present });
}

export async function lock(): Promise<void> {
  // clear() rather than deleting named keys, so adding a field later cannot
  // leave a secret behind.
  await chrome.storage.session.clear();
  await chrome.storage.local.remove("resume");
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.session.set({ token });
}

export const LOCK_ALARM = "auto-lock";

export async function scheduleLockAlarm(): Promise<void> {
  await chrome.alarms.create(LOCK_ALARM, { periodInMinutes: 1 });
}
