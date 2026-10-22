import {
  createAccount,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open,
  unlockVault,
  type KdfParams,
  type SealedData,
} from "#core/crypto.js";
import { toBase64 } from "#core/bytes.js";
import { signal } from "@preact/signals";
import {
  api,
  assertMasterPasswordPolicy,
  getUnlocked,
  localeSignal,
  lock,
  memoryArea,
  refreshSession,
  setLocal,
  touch,
  unlock,
  upgradeKdf,
  usePlatform,
  vaultKeySignal,
} from "#ext/web-host.js";

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
    if (Date.now() - lastTouch < TOUCH_INTERVAL_MS) {
      return;
    }
    lastTouch = Date.now();
    void touch();
  };
  for (const event of ["pointerdown", "keydown"]) {
    addEventListener(event, onActivity, { passive: true });
  }

  setInterval(() => {
    if (!vaultKeySignal.value) {
      return;
    }
    void getUnlocked().then((unlocked) => {
      if (!unlocked?.token) {
        void refreshSession();
      }
    });
  }, CHECK_INTERVAL_MS);
}

export interface PendingSignIn {
  email: string;
  password: string;
  kdf: KdfParams;
  authKey: string;
  challenge: string;
}

export async function signIn(email: string, password: string): Promise<PendingSignIn | null> {
  const kdf = await api.prelogin(email);
  const masterKey = await deriveMasterKey(email, password, kdf);
  const authKey = toBase64(await deriveAuthKey(masterKey));
  const login = await api.login(email, authKey, localeSignal.value);
  if (api.needsSecondFactor(login)) {
    return { email, password, kdf, authKey, challenge: login.challenge };
  }
  await openSession(email, password, kdf, authKey, login);
  return null;
}

export async function signInWithCode(pending: PendingSignIn, code: string): Promise<void> {
  const login = await api.loginSecondFactor(pending.challenge, code);
  await openSession(pending.email, pending.password, pending.kdf, pending.authKey, login);
}

async function openSession(
  email: string,
  password: string,
  kdf: KdfParams,
  authKey: string,
  login: api.LoginSuccess,
): Promise<void> {
  const masterKey = await deriveMasterKey(email, password, kdf);
  let { wrappedVaultKey } = login;
  const vaultKeyRaw = await open(await deriveWrappingKey(masterKey), wrappedVaultKey);
  if (login.upgradeKdf) {
    const upgraded = await upgradeKdf(email, password, vaultKeyRaw, authKey, login.token);
    if (upgraded) {
      ({ kdf, wrappedVaultKey } = upgraded);
    }
  }
  await setLocal({ email, kdf, wrappedVaultKey });
  await unlock(toBase64(vaultKeyRaw), login.token);
  accountEmail.value = email;
  await refreshSession();
}

export async function openVaultWithPassword(
  email: string,
  password: string,
  kdf: KdfParams,
  wrappedVaultKey: SealedData,
  token: string,
): Promise<void> {
  const { vaultKeyRaw } = await unlockVault(email, password, { kdf, wrappedVaultKey });
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
  assertMasterPasswordPolicy(password, email);
  const { record } = await createAccount(email, password);
  const { token, orgId } = await api.register(email, record, "", verificationCode, inviteId);
  const { vaultKeyRaw } = await unlockVault(email, password, record);
  await setLocal({ email, kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
  if (orgId) {
    location.hash = `#/${orgId}/projects`;
  }
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
