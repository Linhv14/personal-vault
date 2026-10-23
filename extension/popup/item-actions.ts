import { describeError } from "#i18n/index.js";
import { scheduleClipboardClear } from "../lib/clipboard.js";
import { draftOf, markUsed, removeItem, saveItem } from "../lib/vault/store.js";
import type { VaultItem } from "../lib/vault/types.js";
import { itemType } from "../lib/item-types.js";
import { enqueue } from "./write-queue.js";
import { items, nowMs, openEditor, showList, toast, translator, vaultKey } from "./state.js";

type Draft = Omit<VaultItem, "createdAt" | "updatedAt">;

function showLocally(item: VaultItem): void {
  items.value = items.value.some((candidate) => candidate.id === item.id)
    ? items.value.map((candidate) => (candidate.id === item.id ? item : candidate))
    : [item, ...items.value];
}

function dropLocally(id: string): void {
  items.value = items.value.filter((candidate) => candidate.id !== id);
}

function patchLocally(id: string, patch: Partial<VaultItem>): void {
  items.value = items.value.map((candidate) =>
    candidate.id === id ? { ...candidate, ...patch } : candidate,
  );
}

function failed(error: unknown): void {
  toast(describeError(error, translator()));
}

function write(before: VaultItem, draft: Draft, onFailure = failed): Promise<void> {
  const key = vaultKey.value;
  if (!key) {
    return Promise.resolve();
  }
  showLocally({ ...draft, createdAt: before.createdAt, updatedAt: before.updatedAt });
  return enqueue(before.id, async () => {
    try {
      const saved = await saveItem(key, draft, before);
      patchLocally(saved.id, { updatedAt: saved.updatedAt });
    } catch (error) {
      showLocally(before);
      onFailure(error);
    }
  });
}

export function saveEditedItem(draft: Draft, before: VaultItem | null): Promise<void> {
  const t = translator();
  const now = Math.floor(nowMs() / 1000);
  const key = vaultKey.value;
  if (!key) {
    return Promise.resolve();
  }
  showLocally({
    ...draft,
    createdAt: before?.createdAt ?? now,
    updatedAt: before?.updatedAt ?? now,
  });
  showList();
  toast(t(before ? "edit.saved" : "edit.added"));
  return enqueue(draft.id, async () => {
    try {
      const saved = await saveItem(key, draft, before ?? undefined);
      patchLocally(saved.id, { updatedAt: saved.updatedAt, createdAt: saved.createdAt });
    } catch (error) {
      if (before) {
        showLocally(before);
      } else {
        dropLocally(draft.id);
      }
      failed(error);
      openEditor(before, itemType(draft), draft);
    }
  });
}

export function setFavorite(item: VaultItem, favorite: boolean): Promise<void> {
  toast(translator()(favorite ? "item.favorited" : "item.unfavorited"));
  return write(item, { ...draftOf(item), favorite });
}

export function setUsedCodes(item: VaultItem, usedCodes: string[] | undefined): Promise<void> {
  const { usedCodes: _usedCodes, ...draft } = draftOf(item);
  return write(item, usedCodes ? { ...draft, usedCodes } : draft);
}

export function setTrashed(item: VaultItem, trashed: boolean): Promise<void> {
  const { trashedAt: _trashedAt, ...draft } = draftOf(item);
  const saving = write(item, trashed ? { ...draft, trashedAt: Math.floor(nowMs() / 1000) } : draft);
  showList();
  toast(translator()(trashed ? "edit.trashed" : "edit.restored"));
  return saving;
}

export function deleteForever(item: VaultItem): Promise<void> {
  const t = translator();
  if (!confirm(t("edit.delete_confirm", { title: item.title }))) {
    return Promise.resolve();
  }
  dropLocally(item.id);
  toast(t("edit.deleted"));
  return enqueue(item.id, async () => {
    try {
      await removeItem(item.id, item);
    } catch (error) {
      showLocally(item);
      failed(error);
    }
  });
}

export async function copy(value: string, what: string, from?: VaultItem): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast(translator()("common.copied", { what }));
  const key = vaultKey.value;
  if (from && key) {
    const usedAt = Math.floor(Date.now() / 1000);
    void enqueue(from.id, async () => {
      await markUsed(key, from, usedAt).catch(() => undefined);
    });
    patchLocally(from.id, { lastUsedAt: usedAt });
  }
  await scheduleClipboardClear();
}
