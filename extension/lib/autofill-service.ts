import { generatePassword } from "../../src/core/generator.js";
import { generateTotp, parseTotpInput, type TotpConfig } from "../../src/core/totp.js";
import { withPasswordHistory } from "./item-types.js";
import type {
  AutofillRequest,
  AutofillResponse,
  PendingPrompt,
  Suggestion,
  TotpPrompt,
} from "./autofill-protocol.js";
import { getLocal } from "./storage.js";
import {
  byLastUsed,
  markUsed,
  matchesSite,
  newItemId,
  openVault,
  registrableDomain,
  sameSite,
  siteOf,
  saveItem,
  type OpenVault,
  type VaultItem,
  isPersonal,
} from "./vault.js";

const PENDING_TTL_MS = 5 * 60_000;
const UNCONFIRMED_TTL_MS = 60_000;

interface PendingCapture {
  domain: string;
  site?: string;
  username?: string;
  password: string;
  at: number;
  confirmed?: boolean;
}

export interface TrustedSender {
  tabId: number;
  url: string;
  domain: string;
  site?: string;
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
  return { tabId: sender.tab.id, url: url.href, domain, site: siteOf(url.href) ?? domain };
}

function pendingKey(tabId: number): string {
  return `autofill:pending:${tabId}`;
}

function totpKey(tabId: number): string {
  return `autofill:totp:${tabId}`;
}

interface PendingTotp {
  domain: string;
  site?: string;
  config: TotpConfig;
  targetId?: string;
  at: number;
}

function suggestionOf(item: VaultItem, vault: OpenVault): Suggestion {
  const shared = vault.sharedName(item);
  return {
    id: item.id,
    title: item.title,
    username: item.username,
    ...(shared ? { vault: shared } : {}),
  };
}

function totpTarget(items: VaultItem[], pageUrl: string): VaultItem | undefined {
  return items
    .filter((item) => isPersonal(item) && matchesSite(item, pageUrl) && sameSite(item, pageUrl))
    .sort(bySite(pageUrl))[0];
}

async function currentCode(config: TotpConfig): Promise<string> {
  const { clockSkew = 0 } = await getLocal();
  return generateTotp(config, Date.now() + clockSkew * 1000);
}

const MAX_QR_IMAGE_BYTES = 512 * 1024;

async function fetchQrImage(url: string): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  try {
    const response = await fetch(target, { credentials: "omit", redirect: "error" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|gif|jpeg|webp|svg\+xml)\b/.test(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_QR_IMAGE_BYTES) return null;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function readPendingTotp(sender: TrustedSender): Promise<PendingTotp | null> {
  const key = totpKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingTotp | undefined;
  if (!pending) return null;
  if (Date.now() - pending.at > PENDING_TTL_MS || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
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
  const candidates = items.filter(
    (item) =>
      isPersonal(item) &&
      matchesSite(item, pageUrl) &&
      (item.username ?? "") === (username ?? "") &&
      (item.urlMatch === "host" || sameSite(item, pageUrl) !== null),
  );
  return (
    candidates.find((item) => sameSite(item, pageUrl) === "exact") ??
    candidates.find((item) => item.urlMatch === "host" || sameSite(item, pageUrl) === "related")
  );
}

function bySite(pageUrl: string) {
  const rank = (item: VaultItem) => (sameSite(item, pageUrl) === "exact" ? 0 : 1);
  return (a: VaultItem, b: VaultItem) => rank(a) - rank(b) || byLastUsed(a, b);
}

function promptFor(
  pending: PendingCapture,
  pageUrl: string,
  items: VaultItem[] | null,
): PendingPrompt | null {
  const existing = items && existingLogin(items, pageUrl, pending.username);
  if (existing?.password === pending.password) return null;
  return {
    domain: pending.site ?? pending.domain,
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
        .sort(bySite(sender.url))
        .map((item) => suggestionOf(item, vault));
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
        site: sender.site,
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
              title: pending.site ?? pending.domain,
              url: pending.site ?? pending.domain,
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

    case "autofill:codes": {
      const vault = await openVault();
      if (!vault) return { ok: true, locked: true };
      const suggestions = vault.items
        .filter((item) => item.totp && matchesSite(item, sender.url))
        .sort(byLastUsed)
        .map((item) => suggestionOf(item, vault));
      return { ok: true, locked: false, suggestions, domain: sender.domain };
    }

    case "autofill:code": {
      const vault = await openVault();
      if (!vault) return { ok: true, locked: true };
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item?.totp || !matchesSite(item, sender.url)) return { ok: false, error: "no_match" };
      void markUsed(vault.key, item).catch(() => {});
      return { ok: true, code: await currentCode(item.totp) };
    }

    case "autofill:totp-found": {
      if (await isVaultServer(sender.url)) return { ok: true, totp: null };
      let config: TotpConfig;
      try {
        config = parseTotpInput(request.text);
      } catch {
        return { ok: true, totp: null };
      }
      const vault = await openVault();
      const target = vault ? totpTarget(vault.items, sender.url) : undefined;
      if (target?.totp?.secret === config.secret) return { ok: true, totp: null };
      const pending: PendingTotp = {
        domain: sender.domain,
        site: sender.site,
        config,
        ...(target ? { targetId: target.id } : {}),
        at: Date.now(),
      };
      await chrome.storage.session.set({ [totpKey(sender.tabId)]: pending });
      const prompt: TotpPrompt = {
        domain: sender.site ?? sender.domain,
        ...(target
          ? { target: target.username ? `${target.title} (${target.username})` : target.title }
          : {}),
        replace: Boolean(target?.totp),
      };
      return { ok: true, totp: prompt };
    }

    case "autofill:totp-save": {
      const pending = await readPendingTotp(sender);
      if (!pending) return { ok: true, saved: false };
      const vault = await openVault();
      if (!vault) {
        await chrome.action.openPopup?.().catch(() => {});
        return { ok: true, saved: false, locked: true };
      }
      const target = vault.items.find(
        (item) => item.id === pending.targetId && isPersonal(item) && matchesSite(item, sender.url),
      );
      await saveItem(
        vault.key,
        target
          ? { ...target, totp: pending.config }
          : {
              id: newItemId(),
              title: pending.site ?? pending.domain,
              url: pending.site ?? pending.domain,
              totp: pending.config,
            },
        target,
      );
      await chrome.storage.session.remove(totpKey(sender.tabId));
      return { ok: true, saved: true, code: await currentCode(pending.config) };
    }

    case "autofill:totp-dismiss":
      await chrome.storage.session.remove(totpKey(sender.tabId));
      return { ok: true, saved: false };

    case "autofill:qr-image":
      return { ok: true, image: await fetchQrImage(request.url) };

    case "autofill:open-popup":
      await chrome.action.openPopup?.().catch(() => {});
      return { ok: true, saved: false };
  }
}
