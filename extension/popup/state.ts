import { signal } from "@preact/signals";
import { createTranslator, describeError, type Translate } from "../../src/i18n/index.js";
import { formatDateTime } from "../ui/format.js";
import { localeSignal } from "../ui/i18n.js";
import * as api from "../lib/api.js";
import {
  autofillSupported,
  enableAutofill,
  isAutofillEnabled,
} from "../lib/autofill-permission.js";
import { scheduleClipboardClear } from "../lib/clipboard.js";
import { getLocal, lock, notePasskeys, setLocal, takeItemFocus, touch } from "../lib/storage.js";
import {
  decryptAll,
  importKey,
  migrateUnboundItems,
  removeItem,
  saveItem,
  sync,
  type VaultItem,
} from "../lib/vault.js";
import { itemType, type ItemType } from "../lib/item-types.js";

export type Screen = "loading" | "setup" | "unlock" | "list" | "edit" | "generator" | "share";
export type Scope = "all" | "favorites" | "trash" | `tag:${string}`;
export type SortOrder = "recent" | "name";
export type SyncProblem = { kind: "offline" | "failed"; message: string } | null;

export const screen = signal<Screen>("loading");
export const vaultKey = signal<CryptoKey | null>(null);
export const items = signal<VaultItem[]>([]);
export const tabUrl = signal<string | undefined>(undefined);
export const clockSkew = signal(0);
export const toastMessage = signal<string | null>(null);

export const scope = signal<Scope>("all");
export const typeFilter = signal<ItemType | "all">("all");
export const sortOrder = signal<SortOrder>("recent");
export const searchQuery = signal("");
export const selectedId = signal<string | null>(null);
export const drawerOpen = signal(false);

export const syncing = signal(false);
export const syncProblem = signal<SyncProblem>(null);
export const clockWarning = signal<string | null>(null);
export const autofillPromo = signal(false);

export const editing = signal<{ item: VaultItem | null; type: ItemType; session: number }>({
  item: null,
  type: "login",
  session: 0,
});
export const sharing = signal<{ item: VaultItem; emailAccess: boolean } | null>(null);

export function translator(): Translate {
  return createTranslator(localeSignal.value);
}

export function nowMs(): number {
  return Date.now() + clockSkew.value * 1000;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  toastMessage.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMessage.value = null), 1800);
}

export async function copy(value: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast(translator()("common.copied", { what }));
  await scheduleClipboardClear();
}

function setItems(next: VaultItem[]): void {
  items.value = next;
  void notePasskeys(next.some((item) => item.passkey && !item.trashedAt));
}

export async function reloadItems(): Promise<void> {
  if (!vaultKey.value) return;
  setItems(await decryptAll(vaultKey.value, localeSignal.value, true));
}

export function showList(): void {
  screen.value = "list";
  void touch();
}

export async function enterVault(rawBase64: string): Promise<void> {
  vaultKey.value = await importKey(rawBase64);
  await reloadItems();
  showList();
  const focus = await takeItemFocus();
  const focused = items.value.find((item) => item.id === focus);
  if (focused) openEditor(focused);
  void backgroundSync();
  void refreshAutofillPromo();
}

async function refreshAutofillPromo(): Promise<void> {
  const { autofillPromoDismissed } = await getLocal();
  const show = autofillSupported() && !autofillPromoDismissed && !(await isAutofillEnabled());
  autofillPromo.value = show;
  if (show) await setLocal({ autofillPromoDismissed: true });
}

export async function turnOnAutofill(): Promise<void> {
  if (!(await enableAutofill())) return;
  toast(translator()("settings.autofill_enabled"));
  autofillPromo.value = false;
}

export async function dismissAutofillPromo(): Promise<void> {
  autofillPromo.value = false;
  await setLocal({ autofillPromoDismissed: true });
}

const SYNC_BAR_DELAY_MS = 300;

async function backgroundSync(): Promise<void> {
  const t = translator();
  const bar = setTimeout(() => (syncing.value = true), SYNC_BAR_DELAY_MS);
  try {
    const synced = await sync();
    if (synced === null) {
      syncProblem.value = { kind: "offline", message: t("list.offline") };
    } else {
      syncProblem.value = null;
      const changed = synced + (vaultKey.value ? await migrateUnboundItems(vaultKey.value) : 0);
      if (changed > 0) await reloadItems();
    }
  } catch (error) {
    syncProblem.value = { kind: "failed", message: describeError(error, t) };
  } finally {
    clearTimeout(bar);
    syncing.value = false;
  }

  const skew = await api.measureClockSkew();
  if (skew === null) return;
  clockSkew.value = skew;
  await setLocal({ clockSkew: skew });
  clockWarning.value =
    Math.abs(skew) > 10
      ? t("list.clock_skew", {
          direction: t(skew > 0 ? "list.clock_behind" : "list.clock_ahead"),
          seconds: Math.abs(skew),
        })
      : null;
}

export function selectItem(id: string | null): void {
  selectedId.value = id;
  screen.value = "list";
  void touch();
}

export function openEditor(
  item: VaultItem | null,
  type: ItemType = item ? itemType(item) : "login",
) {
  editing.value = { item, type, session: editing.value.session + 1 };
  screen.value = "edit";
}

export async function openShare(item: VaultItem): Promise<void> {
  const { apiUrl } = await getLocal();
  const config = await api.serverConfig(apiUrl ?? "");
  sharing.value = { item, emailAccess: config.emailVerification };
  screen.value = "share";
}

export function openGenerator(): void {
  drawerOpen.value = false;
  screen.value = "generator";
}

export function openSettings(page = ""): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`settings/settings.html${page}`) });
}

export function openImport(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL("import/import.html") });
}

export async function lockNow(): Promise<void> {
  await lock();
  location.reload();
}

function withoutTimestamps(item: VaultItem): Omit<VaultItem, "createdAt" | "updatedAt"> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = item;
  return draft;
}

async function replaceItem(draft: Omit<VaultItem, "createdAt" | "updatedAt">): Promise<void> {
  if (!vaultKey.value) return;
  const saved = await saveItem(vaultKey.value, draft);
  items.value = items.value.map((candidate) => (candidate.id === saved.id ? saved : candidate));
}

export async function setFavorite(item: VaultItem, favorite: boolean): Promise<void> {
  try {
    await replaceItem({ ...withoutTimestamps(item), favorite });
  } catch (error) {
    toast(describeError(error, translator()));
  }
}

export async function setUsedCodes(item: VaultItem, usedCodes: string[] | undefined) {
  try {
    const { usedCodes: _usedCodes, ...draft } = withoutTimestamps(item);
    await replaceItem(usedCodes ? { ...draft, usedCodes } : draft);
  } catch (error) {
    toast(describeError(error, translator()));
  }
}

export async function setTrashed(item: VaultItem, trashed: boolean): Promise<void> {
  const { trashedAt: _trashedAt, ...draft } = withoutTimestamps(item);
  await replaceItem(trashed ? { ...draft, trashedAt: Math.floor(nowMs() / 1000) } : draft);
  showList();
  toast(translator()(trashed ? "edit.trashed" : "edit.restored"));
}

export async function deleteForever(item: VaultItem): Promise<void> {
  const t = translator();
  if (!confirm(t("edit.delete_confirm", { title: item.title }))) return;
  try {
    await removeItem(item.id);
    items.value = items.value.filter((candidate) => candidate.id !== item.id);
    toast(t("edit.deleted"));
  } catch (error) {
    toast(describeError(error, t));
  }
}

export function formatDate(epochSeconds: number): string {
  return formatDateTime(epochSeconds, localeSignal.value);
}
