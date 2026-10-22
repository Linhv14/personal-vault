import { sealJson } from "../../../src/core/crypto.js";
import * as api from "../api.js";
import { getLocal, setLocal, type CachedItem } from "../storage.js";
import {
  isSharedVaultId,
  removeSharedItem,
  saveSharedItem,
  sharedVaultOf,
  syncSharedVaults,
} from "./shared.js";
import { isLive, itemAssociatedData, openItem } from "./item-crypto.js";
import type { VaultItem } from "./types.js";

export async function sync(): Promise<number | null> {
  const { lastSync = 0, items = [] } = await getLocal();

  let response: { serverTime: number; items: CachedItem[] };
  try {
    response = await api.fetchItems(lastSync);
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 0) {
      return null;
    }
    throw error;
  }

  let changed = 0;
  if (response.items.length > 0) {
    const merged = new Map(items.map((item) => [item.id, item]));
    for (const incoming of response.items) {
      const existing = merged.get(incoming.id);
      if (!existing || incoming.updatedAt >= existing.updatedAt) {
        if (
          !existing ||
          existing.ciphertext !== incoming.ciphertext ||
          existing.deletedAt !== incoming.deletedAt
        ) {
          changed++;
        }
        merged.set(incoming.id, incoming);
      }
    }
    if (changed > 0) {
      await setLocal({ items: [...merged.values()] });
    }
  }

  await setLocal({ lastSync: response.serverTime });
  const sharedChanged = await syncSharedVaults().catch(() => 0);
  return changed + (sharedChanged ?? 0);
}

const locationOf = (vault: string | undefined) => (isSharedVaultId(vault) ? vault : "personal");

export async function saveItem(
  key: CryptoKey,
  item: Omit<VaultItem, "createdAt" | "updatedAt"> & { createdAt?: number },
  source?: { vault?: string },
): Promise<VaultItem> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...item, createdAt: item.createdAt ?? now, editedAt: now, updatedAt: now };
  const from = source ? locationOf(source.vault) : await locate(item.id);
  const saved = isSharedVaultId(payload.vault)
    ? await saveSharedItem(key, payload.vault, payload)
    : await storeItem(key, payload);
  if (from && from !== (isSharedVaultId(payload.vault) ? payload.vault : "personal")) {
    await removeFrom(from, item.id);
  }
  return saved;
}

async function locate(id: string): Promise<string | null> {
  const row = ((await getLocal()).items ?? []).find((cached) => cached.id === id);
  if (row && isLive(row)) {
    return "personal";
  }
  return sharedVaultOf(id);
}

async function removeFrom(location: string, id: string): Promise<void> {
  if (isSharedVaultId(location)) {
    await removeSharedItem(location, id);
    return;
  }
  const { deletedAt } = await api.deleteItem(id);
  await upsertCache({ id, ciphertext: null, nonce: null, updatedAt: deletedAt, deletedAt });
}

const USE_RECORD_INTERVAL = 60;

function usedRecently(item: VaultItem, now: number): boolean {
  return item.lastUsedAt !== undefined && now - item.lastUsedAt < USE_RECORD_INTERVAL;
}

export async function markUsed(
  key: CryptoKey,
  item: VaultItem,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (usedRecently(item, now) || isSharedVaultId(item.vault)) {
    return;
  }
  if ((await sync()) === null) {
    return;
  }
  const row = ((await getLocal()).items ?? []).find((cached) => cached.id === item.id);
  if (!row || !isLive(row)) {
    return;
  }
  const { item: latest } = await openItem(key, row, false);
  if (usedRecently(latest, now)) {
    return;
  }
  await storeItem(
    key,
    { ...latest, editedAt: latest.editedAt ?? latest.updatedAt, lastUsedAt: now },
    row.updatedAt,
  );
}

async function storeItem(
  key: CryptoKey,
  payload: VaultItem,
  ifUpdatedAt?: number,
): Promise<VaultItem> {
  const sealed = await sealJson(key, payload, itemAssociatedData(payload.id));
  const { updatedAt } = await api.putItem(payload.id, sealed, ifUpdatedAt);

  await upsertCache({
    id: payload.id,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    updatedAt,
    deletedAt: null,
  });

  return { ...payload, updatedAt };
}

export const RATE_LIMIT_PAUSE_MS = 20_000;

export async function saveItemPatiently(
  key: CryptoKey,
  item: Omit<VaultItem, "createdAt" | "updatedAt"> & { createdAt?: number },
  onWait: () => void = () => {},
  pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  source?: { vault?: string },
): Promise<VaultItem> {
  for (;;) {
    try {
      return await saveItem(key, item, source);
    } catch (error) {
      if (!(error instanceof api.ApiError) || error.status !== 429) {
        throw error;
      }
      onWait();
      await pause(RATE_LIMIT_PAUSE_MS);
    }
  }
}

export async function removeItem(id: string, source?: { vault?: string }): Promise<void> {
  await removeFrom(source ? locationOf(source.vault) : ((await locate(id)) ?? "personal"), id);
}

async function upsertCache(row: CachedItem): Promise<void> {
  const { items = [] } = await getLocal();
  const next = items.filter((item) => item.id !== row.id);
  next.push(row);
  await setLocal({ items: next });
}

export function newItemId(): string {
  return crypto.randomUUID();
}
