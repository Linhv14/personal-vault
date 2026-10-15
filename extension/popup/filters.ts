import { ITEM_TYPES, itemType, type ItemType } from "../lib/item-types.js";
import { matchingItems, searchItems, type VaultItem } from "../lib/vault.js";
import type { Scope, SortOrder } from "./state.js";

export interface ListView {
  matched: VaultItem[];
  rest: VaultItem[];
  scoped: VaultItem[];
}

export function live(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => !item.trashedAt);
}

export function scopeExists(scope: Scope, items: VaultItem[]): boolean {
  if (scope === "all") return true;
  if (scope === "trash") return items.some((item) => item.trashedAt);
  if (scope === "favorites") return live(items).some((item) => item.favorite);
  const tag = scope.slice(4);
  return live(items).some((item) => item.tags?.includes(tag));
}

export function inScope(scope: Scope, items: VaultItem[]): VaultItem[] {
  if (scope === "trash") return items.filter((item) => item.trashedAt);
  const current = live(items);
  if (scope === "all") return current;
  if (scope === "favorites") return current.filter((item) => item.favorite);
  const tag = scope.slice(4);
  return current.filter((item) => item.tags?.includes(tag));
}

export function tagsOf(items: VaultItem[], locale: string): string[] {
  return [...new Set(live(items).flatMap((item) => item.tags ?? []))].sort((a, b) =>
    a.localeCompare(b, locale),
  );
}

export function typeCounts(items: VaultItem[]): Map<ItemType, number> {
  const counts = new Map<ItemType, number>(ITEM_TYPES.map((type) => [type, 0]));
  for (const item of items) counts.set(itemType(item), (counts.get(itemType(item)) ?? 0) + 1);
  return counts;
}

function sorted(items: VaultItem[], order: SortOrder, locale: string): VaultItem[] {
  return [...items].sort((a, b) =>
    order === "name"
      ? a.title.localeCompare(b.title, locale, { sensitivity: "base" })
      : (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

export function listView(options: {
  items: VaultItem[];
  scope: Scope;
  type: ItemType | "all";
  query: string;
  order: SortOrder;
  tabUrl: string | undefined;
  locale: string;
}): ListView {
  const scoped = inScope(options.scope, options.items);
  const ofType =
    options.type === "all" ? scoped : scoped.filter((item) => itemType(item) === options.type);
  const found = options.query
    ? searchItems(ofType, options.query)
    : sorted(ofType, options.order, options.locale);
  const showMatches =
    !options.query &&
    options.scope === "all" &&
    (options.type === "all" || options.type === "login");
  const matched = showMatches ? matchingItems(found, options.tabUrl) : [];
  const matchedIds = new Set(matched.map((item) => item.id));
  return { matched, rest: found.filter((item) => !matchedIds.has(item.id)), scoped };
}
