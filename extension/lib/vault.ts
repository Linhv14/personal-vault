/**
 * Client-side vault model: decrypt the cache, sync deltas, save, delete, and
 * find items matching the open tab.
 *
 * Domain matching happens here rather than on the server on purpose. For the
 * server to query by URL it would have to store URLs in the clear, and the list
 * of every site you hold an account on is nearly as sensitive as the passwords.
 */

import { importVaultKey, openJson, sealJson, type SealedData } from "../../src/core/crypto.js";
import { fromBase64, utf8Encode } from "../../src/core/bytes.js";
import type { TotpConfig } from "../../src/core/totp.js";
import * as api from "./api.js";
import { getLocal, setLocal, type CachedItem } from "./storage.js";

export interface VaultItem {
  id: string;
  title: string;
  url?: string;
  username?: string;
  password?: string;
  totp?: TotpConfig;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export async function importKey(vaultKeyRaw: string): Promise<CryptoKey> {
  return importVaultKey(fromBase64(vaultKeyRaw));
}

function itemAssociatedData(id: string) {
  return utf8Encode(`personal-vault/item/${id}`);
}

async function openItem(
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
    if (!allowUnbound) throw error;
    return { item: await openJson<VaultItem>(key, sealed), unbound: true };
  }
}

function isLive(row: CachedItem): row is CachedItem & { ciphertext: string; nonce: string } {
  return !row.deletedAt && Boolean(row.ciphertext) && Boolean(row.nonce);
}

export async function decryptAll(key: CryptoKey, locale = "en"): Promise<VaultItem[]> {
  const { items = [], unboundItemsMigrated = false } = await getLocal();
  const output: VaultItem[] = [];

  for (const row of items) {
    if (!isLive(row)) continue;
    try {
      const { item } = await openItem(key, row, !unboundItemsMigrated);
      output.push({ ...item, id: row.id, updatedAt: row.updatedAt });
    } catch {
      // One corrupt item must not take down the whole list.
      console.warn("Skipping item that failed to decrypt:", row.id);
    }
  }

  return output.sort((a, b) => a.title.localeCompare(b.title, locale));
}

/** Returns the number of changed items, or `null` when offline. */
export async function sync(): Promise<number | null> {
  const { lastSync = 0, items = [] } = await getLocal();

  let response: { serverTime: number; items: CachedItem[] };
  try {
    response = await api.fetchItems(lastSync);
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 0) return null;
    throw error;
  }

  let changed = 0;
  if (response.items.length > 0) {
    const merged = new Map(items.map((item) => [item.id, item]));
    for (const incoming of response.items) {
      const existing = merged.get(incoming.id);
      // Last write wins on the server clock. Two devices editing the same item
      // within the same second is not worth more machinery for a personal vault.
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
    if (changed > 0) await setLocal({ items: [...merged.values()] });
  }

  // The cursor is the server's clock, never the local one.
  await setLocal({ lastSync: response.serverTime });
  return changed;
}

export async function saveItem(
  key: CryptoKey,
  item: Omit<VaultItem, "createdAt" | "updatedAt"> & { createdAt?: number },
): Promise<VaultItem> {
  const now = Math.floor(Date.now() / 1000);
  const payload: VaultItem = { ...item, createdAt: item.createdAt ?? now, updatedAt: now };

  const sealed = await sealJson(key, payload, itemAssociatedData(payload.id));
  const { updatedAt } = await api.putItem(payload.id, sealed);

  await upsertCache({
    id: payload.id,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    updatedAt,
    deletedAt: null,
  });

  return { ...payload, updatedAt };
}

export type ItemDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { createdAt?: number };

const IMPORT_BATCH_SIZE = 100;

export function duplicateKey(item: Pick<VaultItem, "title" | "url" | "username" | "password">) {
  const site = (item.url && registrableDomain(item.url)) || item.title.trim().toLowerCase();
  return [site, item.username ?? "", item.password ?? ""].join("\n");
}

export async function importItems(
  key: CryptoKey,
  drafts: ItemDraft[],
  onProgress: (saved: number) => void = () => {},
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let saved = 0;
  for (let start = 0; start < drafts.length; start += IMPORT_BATCH_SIZE) {
    const chunk = drafts.slice(start, start + IMPORT_BATCH_SIZE).map((draft) => ({
      ...draft,
      id: newItemId(),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    }));
    const sealed = await Promise.all(
      chunk.map(async (item) => ({
        id: item.id,
        ...(await sealJson(key, item, itemAssociatedData(item.id))),
      })),
    );
    const { updatedAt, created } = await api.createItems(sealed);
    const createdIds = new Set(created);
    const { items = [] } = await getLocal();
    await setLocal({
      items: [
        ...items,
        ...sealed
          .filter(({ id }) => createdIds.has(id))
          .map(({ id, ciphertext, nonce }) => ({
            id,
            ciphertext,
            nonce,
            updatedAt,
            deletedAt: null,
          })),
      ],
    });
    saved += createdIds.size;
    onProgress(saved);
  }
  return saved;
}

export async function removeItem(id: string): Promise<void> {
  const { deletedAt } = await api.deleteItem(id);
  await upsertCache({ id, ciphertext: null, nonce: null, updatedAt: deletedAt, deletedAt });
}

export async function migrateUnboundItems(key: CryptoKey): Promise<number> {
  const { items = [], unboundItemsMigrated = false } = await getLocal();
  if (unboundItemsMigrated) return 0;

  let migrated = 0;
  for (const row of items) {
    if (!isLive(row)) continue;
    let opened: { item: VaultItem; unbound: boolean };
    try {
      opened = await openItem(key, row, true);
    } catch {
      continue;
    }
    if (!opened.unbound) continue;
    const { updatedAt: _updatedAt, ...item } = opened.item;
    await saveItem(key, { ...item, id: row.id });
    migrated++;
  }

  await setLocal({ unboundItemsMigrated: true });
  return migrated;
}

async function upsertCache(row: CachedItem): Promise<void> {
  const { items = [] } = await getLocal();
  const next = items.filter((item) => item.id !== row.id);
  next.push(row);
  await setLocal({ items: next });
}

export function newItemId(): string {
  // The client mints ids so create and update share one PUT path, which makes a
  // retry after a dropped connection idempotent instead of duplicating.
  return crypto.randomUUID();
}

/**
 * The comparable part of a hostname.
 *
 * No Public Suffix List — that is a few thousand lines needing regular updates —
 * so `a.github.io` and `b.github.io` are treated as one domain. The consequence
 * is an irrelevant suggestion in a list, not a security hole: this only ranks
 * suggestions, it never fills anything into a page.
 */
const SHARED_HOSTING_SUFFIXES = new Set([
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "appspot.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "onrender.com",
  "fly.dev",
  "glitch.me",
  "ngrok.io",
  "ngrok-free.app",
  "repl.co",
  "surge.sh",
]);

export function registrableDomain(rawUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`).hostname;
  } catch {
    return null;
  }
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return hostname;
  const labels = hostname.replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  if (SHARED_HOSTING_SUFFIXES.has(labels.slice(-2).join("."))) {
    return labels.slice(-3).join(".");
  }

  // Common two-level suffixes: com.vn, co.uk, ac.jp...
  const twoPartTlds = new Set(["com", "net", "org", "edu", "gov", "co", "ac"]);
  const secondLast = labels.at(-2);
  const last = labels.at(-1);
  if (last && secondLast && last.length === 2 && twoPartTlds.has(secondLast)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function matchingItems(items: VaultItem[], tabUrl: string | undefined): VaultItem[] {
  if (!tabUrl) return [];
  const target = registrableDomain(tabUrl);
  if (!target) return [];
  return items.filter((item) => item.url && registrableDomain(item.url) === target);
}

export function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.title, item.username, item.url, item.totp?.issuer]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(needle)),
  );
}

export type { SealedData };
