import { registrableDomain, siteHostname, siteOf } from "#core/site.js";
import { itemType } from "../item-types.js";
import { isSharedVaultId } from "./vault-ids.js";
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

const TITLE_NOISE = new Set([
  "recovery",
  "codes",
  "code",
  "backup",
  "2fa",
  "mfa",
  "otp",
  "account",
]);

export function siteLabel(domain: string): string {
  return domain.split(".")[0] ?? domain;
}

export function domainsOf(item: Pick<VaultItem, "url" | "urls">): string[] {
  return [
    ...new Set(
      itemSites(item)
        .map((site) => registrableDomain(site))
        .filter((domain): domain is string => domain !== null),
    ),
  ];
}

export function labelFromTitle(title: string): string | null {
  return (
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((word) => word.length > 0 && !TITLE_NOISE.has(word)) ?? null
  );
}

export function isOwnLogin(item: VaultItem): boolean {
  return itemType(item) === "login" && !isSharedVaultId(item.vault) && !item.trashedAt;
}

function sameUser(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function loginForPasskey(
  items: readonly VaultItem[],
  domain: string,
  userName: string,
): VaultItem | undefined {
  const free = items.filter(
    (item) => isOwnLogin(item) && !item.passkey && domainsOf(item).includes(domain),
  );
  return (
    free.find((item) => sameUser(item.username, userName)) ??
    (free.length === 1 ? free[0] : undefined)
  );
}

export function loginForCodes(items: readonly VaultItem[], title: string): VaultItem | undefined {
  const label = labelFromTitle(title);
  const logins = label
    ? items.filter(
        (item) => isOwnLogin(item) && domainsOf(item).some((domain) => siteLabel(domain) === label),
      )
    : [];
  return logins.length === 1 && !logins[0]?.codes?.length ? logins[0] : undefined;
}
