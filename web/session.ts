import {
  createAccount,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open,
  unlockVault,
} from "../src/core/crypto.js";
import { toBase64 } from "../src/core/bytes.js";
import { signal } from "@preact/signals";
import * as api from "../extension/lib/api.js";
import { upgradeKdf } from "../extension/lib/kdf-upgrade.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { getUnlocked, lock, setLocal, touch, unlock } from "../extension/lib/storage.js";
import { refreshSession, vaultKeySignal } from "../extension/ui/store/session.js";

export const IDLE_MINUTES = 15;
export const accountEmail = signal<string | null>(null);
const CHECK_INTERVAL_MS = 5_000;
const TOUCH_INTERVAL_MS = 30_000;

export function startWebSession(): void {
  usePlatform({
    local: memoryArea({ apiUrl: location.origin, autoLockMinutes: IDLE_MINUTES }),
    session: memoryArea(),
    scheduleLock: async () => {},
  });

  let lastTouch = 0;
  const onActivity = () => {
    if (Date.now() - lastTouch < TOUCH_INTERVAL_MS) return;
    lastTouch = Date.now();
    void touch();
  };
  for (const event of ["pointerdown", "keydown"]) {
    addEventListener(event, onActivity, { passive: true });
  }

  setInterval(() => {
    if (!vaultKeySignal.value) return;
    void getUnlocked().then((unlocked) => {
      if (!unlocked?.token) void refreshSession();
    });
  }, CHECK_INTERVAL_MS);
}

export async function signIn(email: string, password: string): Promise<void> {
  let kdf = await api.prelogin(email);
  const masterKey = await deriveMasterKey(email, password, kdf);
  const authKey = toBase64(await deriveAuthKey(masterKey));
  const login = await api.login(email, authKey);
  let { wrappedVaultKey } = login;
  const vaultKeyRaw = await open(await deriveWrappingKey(masterKey), wrappedVaultKey);
  if (login.upgradeKdf) {
    const upgraded = await upgradeKdf(email, password, vaultKeyRaw, authKey, login.token);
    if (upgraded) ({ kdf, wrappedVaultKey } = upgraded);
  }
  const { token } = login;
  await setLocal({ email, kdf, wrappedVaultKey });
  await unlock(toBase64(vaultKeyRaw), token);
  accountEmail.value = email;
  await refreshSession();
}

export async function registerFromInvite(
  email: string,
  password: string,
  inviteId: string,
  verificationCode: string | undefined,
): Promise<string | undefined> {
  const { record } = await createAccount(email, password);
  const { token, orgId } = await api.register(email, record, "", verificationCode, inviteId);
  const { vaultKeyRaw } = await unlockVault(email, password, record);
  await setLocal({ email, kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
  if (orgId) location.hash = `#/${orgId}/projects`;
  await unlock(toBase64(vaultKeyRaw), token);
  accountEmail.value = email;
  await refreshSession();
  return orgId;
}

export async function signOut(): Promise<void> {
  await api.logout();
  await lock();
  await refreshSession();
}
