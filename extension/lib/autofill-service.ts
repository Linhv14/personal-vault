import { generatePassword } from "../../src/core/generator.js";
import type { AutofillRequest, AutofillResponse, PendingPrompt } from "./autofill-protocol.js";
import { getUnlocked } from "./storage.js";
import {
  decryptAll,
  importKey,
  newItemId,
  registrableDomain,
  saveItem,
  type VaultItem,
} from "./vault.js";

const PENDING_TTL_MS = 5 * 60_000;

interface PendingCapture {
  domain: string;
  username?: string;
  password: string;
  at: number;
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

function itemMatches(item: VaultItem, domain: string): boolean {
  return Boolean(item.url) && registrableDomain(item.url!) === domain;
}

async function unlocked(): Promise<{ key: CryptoKey; items: VaultItem[] } | null> {
  const session = await getUnlocked();
  if (!session) return null;
  const key = await importKey(session.vaultKeyRaw);
  return { key, items: await decryptAll(key) };
}

function pendingKey(tabId: number): string {
  return `autofill:pending:${tabId}`;
}

async function readPending(sender: TrustedSender): Promise<PendingCapture | null> {
  const key = pendingKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingCapture | undefined;
  if (!pending) return null;
  if (Date.now() - pending.at > PENDING_TTL_MS || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
}

function existingLogin(items: VaultItem[], domain: string, username?: string) {
  return items.find(
    (item) => itemMatches(item, domain) && (item.username ?? "") === (username ?? ""),
  );
}

function promptFor(pending: PendingCapture, items: VaultItem[] | null): PendingPrompt | null {
  const existing = items && existingLogin(items, pending.domain, pending.username);
  if (existing?.password === pending.password) return null;
  return { domain: pending.domain, username: pending.username, update: Boolean(existing) };
}

export async function handleAutofill(
  request: AutofillRequest,
  sender: TrustedSender,
): Promise<AutofillResponse> {
  switch (request.type) {
    case "autofill:suggest": {
      const vault = await unlocked();
      if (!vault) return { ok: true, locked: true };
      const suggestions = vault.items
        .filter((item) => itemMatches(item, sender.domain))
        .map(({ id, title, username }) => ({ id, title, username }));
      return { ok: true, locked: false, suggestions, domain: sender.domain };
    }

    case "autofill:fill": {
      const vault = await unlocked();
      if (!vault) return { ok: true, locked: true };
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item?.password || !itemMatches(item, sender.domain)) {
        return { ok: false, error: "no_match" };
      }
      return { ok: true, credentials: { username: item.username, password: item.password } };
    }

    case "autofill:generate":
      return { ok: true, password: generatePassword({ length: 20 }).value };

    case "autofill:capture": {
      if (!request.password) return { ok: true, prompt: null };
      const pending: PendingCapture = {
        domain: sender.domain,
        username: request.username || undefined,
        password: request.password,
        at: Date.now(),
      };
      const vault = await unlocked();
      const prompt = promptFor(pending, vault?.items ?? null);
      if (prompt) await chrome.storage.session.set({ [pendingKey(sender.tabId)]: pending });
      return { ok: true, prompt };
    }

    case "autofill:pending": {
      const pending = await readPending(sender);
      if (!pending) return { ok: true, prompt: null };
      const vault = await unlocked();
      return { ok: true, prompt: promptFor(pending, vault?.items ?? null) };
    }

    case "autofill:save": {
      const pending = await readPending(sender);
      if (!pending) return { ok: true, saved: false };
      const vault = await unlocked();
      if (!vault) {
        await chrome.action.openPopup?.().catch(() => {});
        return { ok: true, saved: false, locked: true };
      }
      const existing = existingLogin(vault.items, pending.domain, pending.username);
      await saveItem(
        vault.key,
        existing
          ? { ...existing, password: pending.password }
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
