import { rewrapVaultKey, type KdfParams, type SealedData } from "#core/crypto.js";
import type { Bytes } from "#core/bytes.js";
import * as api from "./api.js";

export async function upgradeKdf(
  email: string,
  password: string,
  vaultKeyRaw: Bytes,
  currentAuthKey: string,
  token: string,
): Promise<{ kdf: KdfParams; wrappedVaultKey: SealedData } | null> {
  try {
    const record = await rewrapVaultKey(email, password, vaultKeyRaw);
    await api.changePassword(currentAuthKey, record, { keepSession: true, token });
    return { kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey };
  } catch {
    return null;
  }
}
