import { registrableDomain, siteOf } from "../../../src/core/site.js";
import { getLocal } from "../storage.js";

export interface TrustedSender {
  tabId: number;
  url: string;
  domain: string;
  site?: string;
}

function isFillableUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function senderFor(tabId: number, rawUrl: string | undefined): TrustedSender | null {
  let url: URL;
  try {
    url = new URL(rawUrl ?? "");
  } catch {
    return null;
  }
  const domain = registrableDomain(url.href);
  if (!isFillableUrl(url) || !domain) {
    return null;
  }
  return { tabId, url: url.href, domain, site: siteOf(url.href) ?? domain };
}

export function trustedSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): TrustedSender | null {
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined) {
    return null;
  }
  return senderFor(sender.tab.id, sender.url ?? sender.tab.url);
}

export function tabSender(tab: chrome.tabs.Tab | undefined): TrustedSender | null {
  return tab?.id === undefined ? null : senderFor(tab.id, tab.url);
}

export async function isVaultServer(url: string): Promise<boolean> {
  const { apiUrl } = await getLocal();
  if (!apiUrl) {
    return false;
  }
  try {
    return new URL(url).origin === new URL(apiUrl).origin;
  } catch {
    return false;
  }
}

export async function formsAllowed(sender: TrustedSender): Promise<boolean> {
  return isFillableUrl(new URL(sender.url)) && !(await isVaultServer(sender.url));
}
