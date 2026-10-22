import { registrableDomain, siteHostname, siteOf } from "#core/site.js";
import { itemType } from "../item-types.js";
import type { VaultItem } from "./types.js";

export function sameSite(
  item: Pick<VaultItem, "url" | "urls">,
  pageUrl: string,
): "exact" | "related" | null {
  const page = siteOf(pageUrl);
  const domain = registrableDomain(pageUrl);
  if (!page || !domain) {
    return null;
  }
  let best: "exact" | "related" | null = null;
  for (const site of itemSites(item)) {
    const stored = siteOf(site);
    if (stored === page) {
      return "exact";
    }
    if (registrableDomain(site) === domain && stored === domain) {
      best = "related";
    }
  }
  return best;
}

export function itemSites(item: Pick<VaultItem, "url" | "urls">): string[] {
  return [item.url, ...(item.urls ?? [])].filter((url): url is string => Boolean(url));
}

export function matchesSite(
  item: Pick<VaultItem, "type" | "url" | "urls" | "urlMatch" | "username" | "password" | "note">,
  pageUrl: string,
): boolean {
  if (itemType(item) !== "login") {
    return false;
  }
  const domain = registrableDomain(pageUrl);
  if (!domain) {
    return false;
  }
  const host = siteHostname(pageUrl);
  return itemSites(item).some((site) =>
    item.urlMatch === "host" ? siteHostname(site) === host : registrableDomain(site) === domain,
  );
}

export function matchingItems(items: VaultItem[], tabUrl: string | undefined): VaultItem[] {
  if (!tabUrl) {
    return [];
  }
  return items.filter((item) => matchesSite(item, tabUrl));
}
