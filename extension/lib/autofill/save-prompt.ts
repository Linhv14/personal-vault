import type { PendingPrompt } from "../autofill-protocol.js";
import { reuseCount } from "../health.js";
import { withPasswordHistory } from "../item-types.js";
import { neverSaves, stopSaving } from "../never-save.js";
import { isPersonal, openVault } from "../vault/decrypt.js";
import { byLastUsed } from "../vault/search.js";
import { matchesSite, sameSite } from "../vault/site-match.js";
import { newItemId, saveItem } from "../vault/store.js";
import type { VaultItem } from "../vault/types.js";
import type { AutofillHandlers } from "./handler.js";
import { isVaultServer, type TrustedSender } from "./senders.js";
import { identifierKey, PENDING_TTL_MS, pendingKey } from "./tab-state.js";

const UNCONFIRMED_TTL_MS = 60_000;

interface PendingCapture {
  domain: string;
  site?: string;
  username?: string;
  password: string;
  at: number;
  confirmed?: boolean;
  dismissed?: boolean;
}

interface PendingIdentifier {
  domain: string;
  username: string;
  at: number;
}

async function rememberedIdentifier(sender: TrustedSender): Promise<string | undefined> {
  const key = identifierKey(sender.tabId);
  const stored = (await chrome.storage.session.get(key))[key] as PendingIdentifier | undefined;
  if (!stored || stored.domain !== sender.domain || Date.now() - stored.at > PENDING_TTL_MS) {
    return undefined;
  }
  return stored.username;
}

async function readPending(sender: TrustedSender): Promise<PendingCapture | null> {
  const key = pendingKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingCapture | undefined;
  if (pending && (await neverSaves("logins", sender.domain))) {
    await chrome.storage.session.remove(key);
    return null;
  }
  if (!pending) {
    return null;
  }
  const ttl = pending.confirmed ? PENDING_TTL_MS : UNCONFIRMED_TTL_MS;
  if (Date.now() - pending.at > ttl || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
}

function sameUsername(a?: string, b?: string): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function existingLogin(items: VaultItem[], pageUrl: string, username?: string) {
  const onSite = items.filter(
    (item) =>
      isPersonal(item) &&
      matchesSite(item, pageUrl) &&
      (item.urlMatch === "host" || sameSite(item, pageUrl) !== null),
  );
  const candidates = onSite.filter((item) => sameUsername(item.username, username));
  const logins = onSite.filter((item) => item.password);
  const fallback =
    !username && candidates.length === 0 ? [...logins].sort(byLastUsed).slice(0, 1) : [];
  const pool = candidates.length > 0 ? candidates : fallback;
  return (
    pool.find((item) => sameSite(item, pageUrl) === "exact") ??
    pool.find((item) => item.urlMatch === "host" || sameSite(item, pageUrl) === "related")
  );
}

function alreadySaved(items: VaultItem[], pageUrl: string, password: string): boolean {
  return items.some((item) => item.password === password && matchesSite(item, pageUrl));
}

function promptFor(
  pending: PendingCapture,
  pageUrl: string,
  items: VaultItem[] | null,
): PendingPrompt | null {
  if (items && alreadySaved(items, pageUrl, pending.password)) {
    return null;
  }
  const existing = items && existingLogin(items, pageUrl, pending.username);
  const reused = items ? reuseCount(items, pending.password, existing?.id) : 0;
  return {
    domain: pending.site ?? pending.domain,
    username: pending.username ?? existing?.username,
    password: pending.password,
    update: Boolean(existing),
    confirmed: Boolean(pending.confirmed),
    ...(reused > 0 ? { reused } : {}),
  };
}

export const savePromptHandlers: AutofillHandlers<
  | "autofill:identifier"
  | "autofill:capture"
  | "autofill:pending"
  | "autofill:confirm"
  | "autofill:save"
  | "autofill:dismiss"
> = {
  "autofill:identifier": async (request, sender) => {
    const username = request.username.trim();
    if (username && !(await isVaultServer(sender.url))) {
      const stored: PendingIdentifier = { domain: sender.domain, username, at: Date.now() };
      await chrome.storage.session.set({ [identifierKey(sender.tabId)]: stored });
    }
    return { ok: true, prompt: null };
  },

  "autofill:capture": async (request, sender) => {
    if (
      !request.password ||
      (await isVaultServer(sender.url)) ||
      (await neverSaves("logins", sender.domain))
    ) {
      return { ok: true, prompt: null };
    }
    const pending: PendingCapture = {
      domain: sender.domain,
      site: sender.site,
      username: request.username || (await rememberedIdentifier(sender)),
      password: request.password,
      at: Date.now(),
    };
    const vault = await openVault();
    const prompt = promptFor(pending, sender.url, vault?.items ?? null);
    if (prompt) {
      await chrome.storage.session.set({ [pendingKey(sender.tabId)]: pending });
    }
    return { ok: true, prompt };
  },

  "autofill:pending": async (_request, sender) => {
    const pending = await readPending(sender);
    if (!pending || pending.dismissed) {
      return { ok: true, prompt: null };
    }
    const vault = await openVault();
    return { ok: true, prompt: promptFor(pending, sender.url, vault?.items ?? null) };
  },

  "autofill:confirm": async (_request, sender) => {
    const pending = await readPending(sender);
    if (!pending) {
      return { ok: true, prompt: null };
    }
    const confirmed = { ...pending, confirmed: true, at: Date.now() };
    await chrome.storage.session.set({ [pendingKey(sender.tabId)]: confirmed });
    const vault = await openVault();
    return { ok: true, prompt: promptFor(confirmed, sender.url, vault?.items ?? null) };
  },

  "autofill:save": async (request, sender) => {
    const stored = await readPending(sender);
    const pending = stored && {
      ...stored,
      username:
        typeof request.username === "string"
          ? request.username.trim() || undefined
          : stored.username,
      password:
        typeof request.password === "string" && request.password
          ? request.password
          : stored.password,
    };
    if (!pending) {
      return { ok: true, saved: false };
    }
    const vault = await openVault();
    if (!vault) {
      await chrome.storage.session.set({ [pendingKey(sender.tabId)]: pending });
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
            title: pending.site ?? pending.domain,
            url: pending.site ?? pending.domain,
            username: pending.username,
            password: pending.password,
          },
    );
    await chrome.storage.session.remove(pendingKey(sender.tabId));
    return { ok: true, saved: true };
  },

  "autofill:dismiss": async (request, sender) => {
    if (request.never) {
      await chrome.storage.session.remove(pendingKey(sender.tabId));
      await stopSaving("logins", sender.domain);
      return { ok: true, saved: false };
    }
    const pending = await readPending(sender);
    if (pending?.confirmed && !pending.dismissed) {
      await chrome.storage.session.set({
        [pendingKey(sender.tabId)]: { ...pending, dismissed: true },
      });
    } else {
      await chrome.storage.session.remove(pendingKey(sender.tabId));
    }
    return { ok: true, saved: false };
  },
};

export async function missedSave(sender: TrustedSender): Promise<PendingPrompt | null> {
  const pending = await readPending(sender);
  if (!pending?.dismissed) {
    return null;
  }
  const vault = await openVault();
  return vault ? promptFor(pending, sender.url, vault.items) : null;
}

export async function forgetMissedSave(sender: TrustedSender): Promise<void> {
  await chrome.storage.session.remove(pendingKey(sender.tabId));
}
