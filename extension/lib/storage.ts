import type { KdfParams, SealedData } from "#core/crypto.js";
import type { LocalePreference } from "#i18n/index.js";
import { isPlainObject } from "#core/json.js";
import { needsCacheRepair, normalizeLocalState } from "./local-state.js";
import { platform } from "./platform.js";

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
  wrappedVaultKey?: SealedData;
  items?: CachedItem[];
  lastSync?: number;
  unboundItemsMigrated?: boolean;
  aadBoundAccounts?: string[];
  autofillPromoDismissed?: boolean;
  neverAskForms?: string[];
  sharedLinks?: SealedData;
  autoLockMinutes?: number;
  hasPasskeys?: boolean;
  clockSkew?: number;
  locale?: LocalePreference;
  showLogos?: boolean;
  resume?: { token: string; sealed: SealedData };
  pin?: { token: string; salt: string; iterations: number; sealed: SealedData };
  biometric?: { token: string; credentialId: string; secret: string; sealed: SealedData };
  biometricPromoDismissed?: boolean;
  identity?: { publicKey: string; wrappedPrivateKey: SealedData };
  sharedVaults?: CachedSharedVault[];
  sharedGenerations?: Record<string, number>;
}

export interface CachedSharedVault {
  orgId: string;
  orgName: string;
  teamId: string;
  name: string;
  generation: number;
  rekeyNeeded: boolean;
  viewOnly?: boolean;
  wrappedKey: { ephemeralPublicKey: string; sealed: SealedData };
  items: { id: string; sealed: SealedData; updatedAt: number; updatedBy: string }[];
}

interface SessionState {
  vaultKeyRaw?: string;
  token?: string;
  lockAt?: number;
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

function isPendingSignup(value: unknown): value is PendingSignup {
  return (
    isPlainObject(value) &&
    typeof value.apiUrl === "string" &&
    typeof value.email === "string" &&
    typeof value.registrationToken === "string" &&
    typeof value.sentAt === "number"
  );
}
const PENDING_SIGNUP_TTL_MS = 15 * 60_000;

export async function savePendingSignup(signup: PendingSignup): Promise<void> {
  await platform().session.set({ [PENDING_SIGNUP_KEY]: signup });
}

export async function loadPendingSignup(): Promise<PendingSignup | null> {
  const signup = (await platform().session.get(PENDING_SIGNUP_KEY))[PENDING_SIGNUP_KEY];
  if (!isPendingSignup(signup)) {
    return null;
  }
  if (Date.now() - signup.sentAt > PENDING_SIGNUP_TTL_MS) {
    await clearPendingSignup();
    return null;
  }
  return signup;
}

export async function clearPendingSignup(): Promise<void> {
  await platform().session.remove(PENDING_SIGNUP_KEY);
}

export async function getLocal(): Promise<LocalState> {
  const raw = await platform().local.get(null);
  const state = normalizeLocalState(raw);
  if (needsCacheRepair(raw, state)) {
    await platform().local.set({ items: state.items ?? [] });
    await platform().local.remove("lastSync");
  }
  return state;
}

export async function setLocal(patch: Partial<LocalState>): Promise<void> {
  await platform().local.set(patch);
}

const DEVICE_PREFERENCES = [
  "locale",
  "autoLockMinutes",
  "autofillPromoDismissed",
  "aadBoundAccounts",
] as const satisfies readonly (keyof LocalState)[];

export async function clearAccountData(): Promise<void> {
  const local = await getLocal();
  const preferences = Object.fromEntries(
    DEVICE_PREFERENCES.filter((key) => local[key] !== undefined).map((key) => [key, local[key]]),
  );
  await platform().local.clear();
  await platform().local.set(preferences);
}

async function getSession(): Promise<SessionState> {
  const { vaultKeyRaw, token, lockAt, focusItem } = await platform().session.get(null);
  return {
    ...(typeof vaultKeyRaw === "string" ? { vaultKeyRaw } : {}),
    ...(typeof token === "string" ? { token } : {}),
    ...(typeof lockAt === "number" ? { lockAt } : {}),
    ...(typeof focusItem === "string" ? { focusItem } : {}),
  };
}

export async function getUnlocked(): Promise<{ vaultKeyRaw: string; token?: string } | null> {
  const session = await getSession();
  if (!session.vaultKeyRaw) {
    return null;
  }

  if (session.lockAt && Date.now() > session.lockAt) {
    await lock();
    return null;
  }
  return { vaultKeyRaw: session.vaultKeyRaw, token: session.token };
}

export async function unlock(vaultKeyRaw: string, token: string | undefined): Promise<void> {
  await platform().session.remove("lockAt");
  await platform().session.set({ vaultKeyRaw, token, ...(await lockDeadline()) });
  await scheduleLockAlarm();
}

export async function requestItemFocus(id: string): Promise<void> {
  await platform().session.set({ focusItem: id });
}

export async function takeItemFocus(): Promise<string | undefined> {
  const { focusItem } = await getSession();
  if (focusItem) {
    await platform().session.remove("focusItem");
  }
  return focusItem;
}

export async function touch(): Promise<void> {
  const session = await getSession();
  if (!session.vaultKeyRaw) {
    return;
  }
  const deadline = await lockDeadline();
  if (deadline.lockAt) {
    await platform().session.set(deadline);
  } else {
    await platform().session.remove("lockAt");
  }
}

export async function notePasskeys(present: boolean): Promise<void> {
  await setLocal({ hasPasskeys: present });
}

export async function lock(): Promise<void> {
  await platform().session.clear();
  await platform().local.remove("resume");
}

export async function setToken(token: string): Promise<void> {
  await platform().session.set({ token });
}

export const LOCK_ALARM = "auto-lock";

export async function scheduleLockAlarm(): Promise<void> {
  await platform().scheduleLock(LOCK_ALARM);
}
