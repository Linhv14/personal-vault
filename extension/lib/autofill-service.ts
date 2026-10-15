import { generatePassword } from "../../src/core/generator.js";
import { withPasswordHistory } from "./item-types.js";
import type { AutofillRequest, AutofillResponse, PendingPrompt } from "./autofill-protocol.js";
import { getLocal } from "./storage.js";
import {
  byLastUsed,
  markUsed,
  matchesSite,
  newItemId,
  openVault,
  registrableDomain,
  saveItem,
  type VaultItem,
} from "./vault.js";

const PENDING_TTL_MS = 5 * 60_000;
const UNCONFIRMED_TTL_MS = 60_000;

interface PendingCapture {
  domain: string;
  username?: string;
  password: string;
  at: number;
  confirmed?: boolean;
}

export interface TrustedSender {
  tabId: number;
  url: string;
  domain: string;
}

function isFillableUrl(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function trustedSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): TrustedSender | null {
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(sender.url ?? sender.tab.url ?? "");
  } catch {
    return null;
  }
  const domain = registrableDomain(url.href);
  if (!isFillableUrl(url) || !domain) return null;
  return { tabId: sender.tab.id, url: url.href, domain };
}

function pendingKey(tabId: number): string {
  return `autofill:pending:${tabId}`;
}

async function readPending(sender: TrustedSender): Promise<PendingCapture | null> {
  const key = pendingKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingCapture | undefined;
  if (!pending) return null;
  const ttl = pending.confirmed ? PENDING_TTL_MS : UNCONFIRMED_TTL_MS;
  if (Date.now() - pending.at > ttl || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
}

function existingLogin(items: VaultItem[], pageUrl: string, username?: string) {
  return items.find(
    (item) => matchesSite(item, pageUrl) && (item.username ?? "") === (username ?? ""),
  );
}

function promptFor(
  pending: PendingCapture,
  pageUrl: string,
  items: VaultItem[] | null,
): PendingPrompt | null {
  const existing = items && existingLogin(items, pageUrl, pending.username);
  if (existing?.password === pending.password) return null;
  return {
    domain: pending.domain,
    username: pending.username,
    update: Boolean(existing),
    confirmed: Boolean(pending.confirmed),
  };
}

async function isVaultServer(url: string): Promise<boolean> {
  const { apiUrl } = await getLocal();
  if (!apiUrl) return false;
  try {
    return new URL(url).origin === new URL(apiUrl).origin;
  } catch {
    return false;
  }
}

export async function handleAutofill(
  request: AutofillRequest,
  sender: TrustedSender,
): Promise<AutofillResponse> {
  switch (request.type) {
    case "autofill:suggest": {
      if (await isVaultServer(sender.url)) {
        return { ok: true, locked: false, suggestions: [], domain: sender.domain };
      }
      const vault = await openVault();
      if (!vault) return { ok: true, locked: true };
      const suggestions = vault.items
        .filter((item) => matchesSite(item, sender.url))
        .sort(byLastUsed)
        .map(({ id, title, username }) => ({ id, title, username }));
      return { ok: true, locked: false, suggestions, domain: sender.domain };
    }

    case "autofill:fill": {
      const vault = await openVault();
      if (!vault) return { ok: true, locked: true };
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item?.password || !matchesSite(item, sender.url)) {
        return { ok: false, error: "no_match" };
      }
      void markUsed(vault.key, item).catch(() => {});
      return { ok: true, credentials: { username: item.username, password: item.password } };
    }

    case "autofill:generate":
      return { ok: true, password: generatePassword({ length: 20 }).value };

    case "autofill:capture": {
      if (!request.password || (await isVaultServer(sender.url))) return { ok: true, prompt: null };
      const pending: PendingCapture = {
        domain: sender.domain,
        username: request.username || undefined,
        password: request.password,
        at: Date.now(),
      };
      const vault = await openVault();
      const prompt = promptFor(pending, sender.url, vault?.items ?? null);
      if (prompt) await chrome.storage.session.set({ [pendingKey(sender.tabId)]: pending });
      return { ok: true, prompt };
    }

    case "autofill:pending": {
      const pending = await readPending(sender);
      if (!pending) return { ok: true, prompt: null };
      const vault = await openVault();
      return { ok: true, prompt: promptFor(pending, sender.url, vault?.items ?? null) };
    }

    case "autofill:confirm": {
      const pending = await readPending(sender);
      if (!pending) return { ok: true, prompt: null };
      const confirmed = { ...pending, confirmed: true, at: Date.now() };
      await chrome.storage.session.set({ [pendingKey(sender.tabId)]: confirmed });
      const vault = await openVault();
      return { ok: true, prompt: promptFor(confirmed, sender.url, vault?.items ?? null) };
    }

    case "autofill:save": {
      const pending = await readPending(sender);
      if (!pending) return { ok: true, saved: false };
      const vault = await openVault();
      if (!vault) {
        await chrome.action.openPopup?.().catch(() => {});
        return { ok: true, saved: false, locked: true };
      }
      const existing = existingLogin(vault.items, sender.url, pending.username);
      await saveItem(
        vault.key,
        existing
          ? {
              ...existing,
              password: pending.password,
              passwordHistory: withPasswordHistory(
                existing,
                pending.password,
                Math.floor(Date.now() / 1000),
              ),
            }
          : {
              id: newItemId(),
              title: pending.domain,
              url: pending.domain,
              username: pending.username,
              password: pending.password,
            },
      );
      await chrome.storage.session.remove(pendingKey(sender.tabId));
      return { ok: true, saved: true };
    }

    case "autofill:dismiss":
      await chrome.storage.session.remove(pendingKey(sender.tabId));
      return { ok: true, saved: false };

    case "autofill:open-popup":
      await chrome.action.openPopup?.().catch(() => {});
      return { ok: true, saved: false };
  }
}
