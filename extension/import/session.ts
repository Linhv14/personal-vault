import { getUnlocked } from "../lib/storage.js";
import { importKey } from "../lib/vault/item-crypto.js";

export async function vaultKey(): Promise<CryptoKey | null> {
  const unlocked = await getUnlocked();
  return unlocked ? importKey(unlocked.vaultKeyRaw) : null;
}
