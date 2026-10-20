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
import type { StoredPasskey } from "./passkey/authenticator.js";
import {
  cardDigits,
  itemType,
  searchableText,
  type CustomField,
  type ItemType,
  type PasswordChange,
} from "./item-types.js";
import * as api from "./api.js";
import { getLocal, getUnlocked, setLocal, type CachedItem } from "./storage.js";
import {
  decryptSharedVaults,
  isSharedVaultId,
  removeSharedItem,
  saveSharedItem,
  sharedVaultOf,
  syncSharedVaults,
} from "./shared-vaults.js";

export interface VaultDef {
  id: string;
  name: string;
  color: string;
  icon: string;
  shared?: { orgName: string; rekeyNeeded: boolean; viewOnly?: boolean };
}

export interface VaultItem {
  id: string;
  type?: ItemType;
  vault?: string;
  system?: "vaults";
  vaults?: VaultDef[];
  favorite?: boolean;
  tags?: string[];
  trashedAt?: number;
  title: string;
  url?: string;
  username?: string;
  password?: string;
  totp?: TotpConfig;
  note?: string;
  passkey?: StoredPasskey;
  cardholder?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardPin?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  codes?: string[];
  usedCodes?: string[];
  ssid?: string;
  urls?: string[];
  urlMatch?: "domain" | "host";
  fields?: CustomField[];
  passwordHistory?: PasswordChange[];
  lastUsedAt?: number;
  expiresOn?: string;
  sshPublicKey?: string;
  sshPrivateKey?: string;
  sshFingerprint?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  swift?: string;
  iban?: string;
  pin?: string;
  documentKind?: string;
  documentNumber?: string;
  issuedOn?: string;
  issuer?: string;
  licenseKey?: string;
  version?: string;
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

export interface OpenVault {
  key: CryptoKey;
  items: VaultItem[];
  sharedName: (item: Pick<VaultItem, "vault">) => string | undefined;
}

export function isPersonal(item: Pick<VaultItem, "vault">): boolean {
  return !isSharedVaultId(item.vault);
}

export async function openVault(): Promise<OpenVault | null> {
  const session = await getUnlocked();
  if (!session) return null;
  const key = await importKey(session.vaultKeyRaw);
  const { items, shared } = await decryptEverything(key, "en", false, true);
  const names = new Map(
    shared.map((vault) => [vault.id, `${vault.name} · ${vault.shared?.orgName ?? ""}`]),
  );
  return { key, items, sharedName: (item) => (item.vault ? names.get(item.vault) : undefined) };
}

export async function decryptEverything(
  key: CryptoKey,
  locale = "en",
  includeTrashed = false,
  includeShared = false,
): Promise<{ items: VaultItem[]; system: VaultItem[]; shared: VaultDef[] }> {
  const { items = [], unboundItemsMigrated = false } = await getLocal();
  const output: VaultItem[] = [];
  const system: VaultItem[] = [];

  for (const row of items) {
    if (!isLive(row)) continue;
    try {
      const { item } = await openItem(key, row, !unboundItemsMigrated);
      const resolved = { ...item, id: row.id, updatedAt: row.updatedAt };
      if (resolved.system) system.push(resolved);
      else if (!resolved.trashedAt || includeTrashed) output.push(resolved);
    } catch {
      // One corrupt item must not take down the whole list.
      console.warn("Skipping item that failed to decrypt:", row.id);
    }
  }

  const shared = includeShared
    ? await decryptSharedVaults(
        key,
        includeTrashed,
        new Set([...output, ...system].map((item) => item.id)),
      )
    : { items: [], vaults: [] };
  output.push(...shared.items);
  return {
    items: output.sort((a, b) => a.title.localeCompare(b.title, locale)),
    system,
    shared: shared.vaults,
  };
}

export async function decryptAll(
  key: CryptoKey,
  locale = "en",
  includeTrashed = false,
): Promise<VaultItem[]> {
  return (await decryptEverything(key, locale, includeTrashed)).items;
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
  const payload = { ...item, createdAt: item.createdAt ?? now, updatedAt: now };
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
  if (row && isLive(row)) return "personal";
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
  if (usedRecently(item, now) || isSharedVaultId(item.vault)) return;
  if ((await sync()) === null) return;
  const row = ((await getLocal()).items ?? []).find((cached) => cached.id === item.id);
  if (!row || !isLive(row)) return;
  const { item: latest } = await openItem(key, row, false);
  if (usedRecently(latest, now)) return;
  await storeItem(key, { ...latest, lastUsedAt: now }, row.updatedAt);
}

export function byLastUsed(a: VaultItem, b: VaultItem): number {
  return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
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
      if (!(error instanceof api.ApiError) || error.status !== 429) throw error;
      onWait();
      await pause(RATE_LIMIT_PAUSE_MS);
    }
  }
}

export type ItemDraft = Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { createdAt?: number };

const IMPORT_BATCH_SIZE = 100;

export function duplicateKey(item: ItemDraft): string {
  const title = item.title.trim().toLowerCase();
  switch (itemType(item)) {
    case "login": {
      const site = (item.url && registrableDomain(item.url)) || title;
      return [site, item.username ?? "", item.password ?? ""].join("\n");
    }
    case "card":
      return ["card", cardDigits(item.cardNumber) || title].join("\n");
    case "identity":
      return ["identity", title, item.fullName ?? "", item.email ?? ""].join("\n");
    case "wifi":
      return ["wifi", item.ssid ?? title, item.password ?? ""].join("\n");
    case "note":
      return ["note", title, item.note ?? ""].join("\n");
    case "recovery":
      return ["recovery", title, (item.codes ?? []).join("\n")].join("\n");
    case "api":
      return ["api", item.url ?? title, item.username ?? "", item.password ?? ""].join("\n");
    case "ssh":
      return ["ssh", item.sshFingerprint || item.sshPublicKey || title].join("\n");
    case "bank":
      return ["bank", item.accountNumber || item.iban || title].join("\n");
    case "document":
      return ["document", item.documentNumber || title].join("\n");
    case "license":
      return ["license", item.licenseKey || title].join("\n");
  }
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

export async function removeItem(id: string, source?: { vault?: string }): Promise<void> {
  await removeFrom(source ? locationOf(source.vault) : ((await locate(id)) ?? "personal"), id);
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

const SIGN_IN_PREFIXES = new Set([
  "accounts",
  "account",
  "login",
  "signin",
  "auth",
  "sso",
  "id",
  "secure",
]);

export function siteOf(rawUrl: string): string | null {
  const host = hostname(rawUrl);
  const domain = registrableDomain(rawUrl);
  if (!host || !domain || host === domain || !host.endsWith(`.${domain}`)) return host ?? domain;
  const [first, ...rest] = host.split(".");
  return first && SIGN_IN_PREFIXES.has(first) && rest.join(".") === domain ? domain : host;
}

export function sameSite(
  item: Pick<VaultItem, "url" | "urls">,
  pageUrl: string,
): "exact" | "related" | null {
  const page = siteOf(pageUrl);
  const domain = registrableDomain(pageUrl);
  if (!page || !domain) return null;
  let best: "exact" | "related" | null = null;
  for (const site of itemSites(item)) {
    const stored = siteOf(site);
    if (stored === page) return "exact";
    if (registrableDomain(site) === domain && stored === domain) {
      best = "related";
    }
  }
  return best;
}

function hostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return null;
  }
}

export function itemSites(item: Pick<VaultItem, "url" | "urls">): string[] {
  return [item.url, ...(item.urls ?? [])].filter((url): url is string => Boolean(url));
}

export function matchesSite(
  item: Pick<VaultItem, "type" | "url" | "urls" | "urlMatch" | "username" | "password" | "note">,
  pageUrl: string,
): boolean {
  if (itemType(item) !== "login") return false;
  const domain = registrableDomain(pageUrl);
  if (!domain) return false;
  const host = hostname(pageUrl);
  return itemSites(item).some((site) =>
    item.urlMatch === "host" ? hostname(site) === host : registrableDomain(site) === domain,
  );
}

export function matchingItems(items: VaultItem[], tabUrl: string | undefined): VaultItem[] {
  if (!tabUrl) return [];
  return items.filter((item) => matchesSite(item, tabUrl));
}

export function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    searchableText(item).some((field) => field.toLowerCase().includes(needle)),
  );
}

export type { SealedData };
