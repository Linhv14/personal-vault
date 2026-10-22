import { sha256 } from "#core/primitives.js";
import { toBase64, utf8Encode } from "#core/bytes.js";
import { getLocal, setLocal } from "../storage.js";
import { isLive, openItem } from "./item-crypto.js";
import { saveItem } from "./store.js";
import type { VaultItem } from "./types.js";

async function accountTag(apiUrl: string, email: string): Promise<string> {
  const digest = await sha256(
    utf8Encode(`personal-vault/aad-bound/${apiUrl.replace(/\/+$/, "")}/${email.toLowerCase()}`),
  );
  return toBase64(digest);
}

export async function unboundItemsAllowed(): Promise<boolean> {
  const { unboundItemsMigrated = false, aadBoundAccounts = [], apiUrl, email } = await getLocal();
  if (unboundItemsMigrated) {
    return false;
  }
  if (!email) {
    return true;
  }
  if (!aadBoundAccounts.includes(await accountTag(apiUrl ?? "", email))) {
    return true;
  }
  await setLocal({ unboundItemsMigrated: true });
  return false;
}

async function markAccountBound(): Promise<void> {
  const { aadBoundAccounts = [], apiUrl, email } = await getLocal();
  const tags = new Set(aadBoundAccounts);
  if (email) {
    tags.add(await accountTag(apiUrl ?? "", email));
  }
  await setLocal({ unboundItemsMigrated: true, aadBoundAccounts: [...tags] });
}

let migration: Promise<number> | null = null;

export function migrateUnboundItems(key: CryptoKey): Promise<number> {
  migration ??= rewriteUnboundItems(key).finally(() => {
    migration = null;
  });
  return migration;
}

async function rewriteUnboundItems(key: CryptoKey): Promise<number> {
  if (!(await unboundItemsAllowed())) {
    return 0;
  }
  const { items = [] } = await getLocal();

  let migrated = 0;
  for (const row of items) {
    if (!isLive(row)) {
      continue;
    }
    let opened: { item: VaultItem; unbound: boolean };
    try {
      opened = await openItem(key, row, true);
    } catch {
      continue;
    }
    if (!opened.unbound) {
      continue;
    }
    const { updatedAt: _updatedAt, ...item } = opened.item;
    await saveItem(key, { ...item, id: row.id });
    migrated++;
  }

  await markAccountBound();
  return migrated;
}
