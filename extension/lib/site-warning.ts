import { findLookalike, type LookalikeMatch } from "../../src/core/lookalike.js";
import { itemType } from "./item-types.js";
import { registrableDomain } from "../../src/core/site.js";
import { itemSites } from "./vault/site-match.js";
import type { VaultItem } from "./vault/types.js";

export function savedLoginDomains(items: VaultItem[]): string[] {
  return items
    .filter((item) => itemType(item) === "login" && !item.trashedAt)
    .flatMap((item) => itemSites(item))
    .flatMap((site) => registrableDomain(site) ?? []);
}

export function siteWarning(
  pageUrl: string | undefined,
  items: VaultItem[],
): LookalikeMatch | null {
  if (!pageUrl) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  return findLookalike(url.hostname, savedLoginDomains(items));
}
