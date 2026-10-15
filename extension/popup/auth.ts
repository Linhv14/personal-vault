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
import { rememberUnlock } from "../lib/resume.js";
import { getLocal, setLocal, unlock } from "../lib/storage.js";
import { enterVault, toast, translator } from "./state.js";

export async function signIn(email: string, password: string): Promise<void> {
  const local = await getLocal();

  let kdf: KdfParams | undefined = local.kdf;
  let wrapped: SealedData | undefined = local.wrappedVaultKey;
  let token: string | undefined;

  try {
    kdf = await api.prelogin(email);
    const masterKey = await deriveMasterKey(email, password, kdf);
    const authKey = toBase64(await deriveAuthKey(masterKey));
    const result = await api.login(email, authKey);
    token = result.token;
    wrapped = result.wrappedVaultKey;
    await setLocal({ kdf, wrappedVaultKey: wrapped });
  } catch (error) {
    const networkFailure = error instanceof api.ApiError && error.status === 0;
    if (!networkFailure || !kdf || !wrapped) throw error;
    toast(translator()("unlock.offline"));
  }

  await finishUnlock(email, password, kdf, wrapped, token);
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
