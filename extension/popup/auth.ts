import {
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
  type KdfParams,
  type SealedData,
} from "../../src/core/crypto.js";
import { toBase64 } from "../../src/core/bytes.js";
import * as api from "../lib/api.js";
import { upgradeKdf } from "../lib/kdf-upgrade.js";
import { rememberUnlock } from "../lib/resume.js";
import { getLocal, setLocal, unlock } from "../lib/storage.js";
import { localeSignal } from "../ui/i18n.js";
import { enterVault, toast, translator } from "./state.js";

export interface PendingSignIn {
  email: string;
  password: string;
  kdf: KdfParams;
  authKey: string;
  challenge: string;
}

export class SecondFactorRequired extends Error {
  constructor(readonly pending: PendingSignIn) {
    super("Second factor required");
    this.name = "SecondFactorRequired";
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const local = await getLocal();

  let kdf: KdfParams | undefined = local.kdf;
  let wrapped: SealedData | undefined = local.wrappedVaultKey;
  let token: string | undefined;

  try {
    kdf = await api.prelogin(email);
    const masterKey = await deriveMasterKey(email, password, kdf);
    const authKey = toBase64(await deriveAuthKey(masterKey));
    const result = await api.login(email, authKey, localeSignal.value);
    if (api.needsSecondFactor(result)) {
      throw new SecondFactorRequired({
        email,
        password,
        kdf,
        authKey,
        challenge: result.challenge,
      });
    }
    ({ kdf, wrapped, token } = await keepLogin(email, password, kdf, authKey, result));
  } catch (error) {
    const networkFailure = error instanceof api.ApiError && error.status === 0;
    if (!networkFailure || !kdf || !wrapped) {
      throw error;
    }
    toast(translator()("unlock.offline"));
  }

  await finishUnlock(email, password, kdf, wrapped, token);
}

export async function signInWithCode(pending: PendingSignIn, code: string): Promise<void> {
  const result = await api.loginSecondFactor(pending.challenge, code);
  const { email, password, authKey } = pending;
  const { kdf, wrapped, token } = await keepLogin(email, password, pending.kdf, authKey, result);
  await finishUnlock(email, password, kdf, wrapped, token);
}

async function keepLogin(
  email: string,
  password: string,
  kdf: KdfParams,
  authKey: string,
  result: api.LoginSuccess,
): Promise<{ kdf: KdfParams; wrapped: SealedData; token: string }> {
  let wrapped = result.wrappedVaultKey;
  if (result.upgradeKdf) {
    const masterKey = await deriveMasterKey(email, password, kdf);
    const raw = await openSealed(await deriveWrappingKey(masterKey), wrapped);
    const upgraded = await upgradeKdf(email, password, raw, authKey, result.token);
    if (upgraded) {
      ({ kdf, wrappedVaultKey: wrapped } = upgraded);
    }
  }
  await setLocal({ kdf, wrappedVaultKey: wrapped });
  return { kdf, wrapped, token: result.token };
}

export async function finishUnlock(
  email: string,
  password: string,
  kdf: KdfParams,
  wrapped: SealedData,
  token: string | undefined,
): Promise<void> {
  const masterKey = await deriveMasterKey(email, password, kdf);
  const wrappingKey = await deriveWrappingKey(masterKey);
  const raw = await openSealed(wrappingKey, wrapped);

  await unlock(toBase64(raw), token);
  await rememberUnlock(toBase64(raw), token);
  await enterVault(toBase64(raw));
}
