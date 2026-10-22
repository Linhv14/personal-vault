import { searchableText } from "../item-types.js";
import type { VaultItem } from "./types.js";

export function byLastUsed(a: VaultItem, b: VaultItem): number {
  return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
}

export function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return items;
  }
  return items.filter((item) =>
    searchableText(item).some((field) => field.toLowerCase().includes(needle)),
  );
}
