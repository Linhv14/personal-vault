import { isSharedVaultId } from "./vault/vault-ids.js";
import { decryptEverything } from "./vault/decrypt.js";
import { removeItem, saveItem } from "./vault/store.js";
import type { VaultItem } from "./vault/types.js";

export const TRASH_RETENTION_DAYS = 30;

const DAY_SECONDS = 86_400;

type Trashed = Pick<VaultItem, "trashedAt" | "vault" | "system">;

export function purgeAt(item: Trashed): number | null {
  if (!item.trashedAt || isSharedVaultId(item.vault)) {
    return null;
  }
  return item.trashedAt + TRASH_RETENTION_DAYS * DAY_SECONDS;
}

export function daysUntilPurge(item: Trashed, now: number): number | null {
  const at = purgeAt(item);
  return at === null ? null : Math.max(0, Math.ceil((at - now) / DAY_SECONDS));
}

export function expiredTrash<T extends Trashed>(items: T[], now: number): T[] {
  return items.filter((item) => {
    const at = purgeAt(item);
    return !item.system && at !== null && now > at;
  });
}

export async function purgeExpiredTrash(key: CryptoKey, now: number): Promise<number> {
  const { items } = await decryptEverything(key, "en", true, false);
  let purged = 0;
  for (const item of expiredTrash(items, now)) {
    try {
      await removeItem(item.id, item);
    } catch {
      break;
    }
    purged++;
  }
  return purged;
}

export async function moveToTrash(key: CryptoKey, item: VaultItem): Promise<VaultItem> {
  const { updatedAt: _updatedAt, ...draft } = item;
  return saveItem(key, { ...draft, trashedAt: Math.floor(Date.now() / 1000) }, item);
}

export async function restoreFromTrash(key: CryptoKey, item: VaultItem): Promise<VaultItem> {
  const { trashedAt: _trashedAt, updatedAt: _updatedAt, ...draft } = item;
  return saveItem(key, draft, item);
}

export async function deleteFromTrash(item: VaultItem): Promise<void> {
  await removeItem(item.id, item);
}
