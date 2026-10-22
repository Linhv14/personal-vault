import {
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  open as openSealed,
} from "#core/crypto.js";
import { toBase64 } from "#core/bytes.js";
import { getLocal } from "./storage.js";

export async function currentAuthKey(password: string): Promise<string | null> {
  const local = await getLocal();
  if (!local.email || !local.kdf || !local.wrappedVaultKey) {
    return null;
  }
  try {
    const masterKey = await deriveMasterKey(local.email, password, local.kdf);
    await openSealed(await deriveWrappingKey(masterKey), local.wrappedVaultKey);
    return toBase64(await deriveAuthKey(masterKey));
  } catch {
    return null;
  }
}
