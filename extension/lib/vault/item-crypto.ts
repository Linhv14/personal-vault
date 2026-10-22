import { importVaultKey, openJson } from "../../../src/core/crypto.js";
import { fromBase64, utf8Encode } from "../../../src/core/bytes.js";
import type { CachedItem } from "../storage.js";
import type { VaultItem } from "./types.js";

export async function importKey(vaultKeyRaw: string): Promise<CryptoKey> {
  return importVaultKey(fromBase64(vaultKeyRaw));
}

export function itemAssociatedData(id: string) {
  return utf8Encode(`personal-vault/item/${id}`);
}

export async function openItem(
  key: CryptoKey,
  row: CachedItem & { ciphertext: string; nonce: string },
  allowUnbound: boolean,
): Promise<{ item: VaultItem; unbound: boolean }> {
  const sealed = { ciphertext: row.ciphertext, nonce: row.nonce };
  try {
    return {
      item: await openJson<VaultItem>(key, sealed, itemAssociatedData(row.id)),
      unbound: false,
    };
  } catch (error) {
    if (!allowUnbound) {
      throw error;
    }
    const item = await openJson<VaultItem>(key, sealed);
    if (item.id !== undefined && item.id !== row.id) {
      throw error;
    }
    return { item, unbound: true };
  }
}

export function isLive(row: CachedItem): row is CachedItem & { ciphertext: string; nonce: string } {
  return !row.deletedAt && Boolean(row.ciphertext) && Boolean(row.nonce);
}
