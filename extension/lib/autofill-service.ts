import { countryOf } from "../../src/core/address-data.js";
import { generateAddress } from "../../src/core/address-generator.js";
import { aliasTag, emailAliases } from "../../src/core/email-alias.js";
import { generatePassword } from "../../src/core/generator.js";
import { generateTotp, parseTotpInput, type TotpConfig } from "../../src/core/totp.js";
import { cardBrand, cardDigits, itemType, lastFour, withPasswordHistory } from "./item-types.js";
import type {
  AddressData,
  CardData,
  AutofillRequest,
  AutofillResponse,
  CardSuggestion,
  IdentitySuggestion,
  PendingPrompt,
  Suggestion,
  TotpPrompt,
} from "./autofill-protocol.js";
import { fillCardFrames } from "./card-frames.js";
import { boundToSite } from "./form-capture.js";
import { handleFormRequest } from "./form-save.js";
import { siteWarning } from "./site-warning.js";
import { getLocal } from "./storage.js";
import { registrableDomain, siteOf } from "../../src/core/site.js";
import { byLastUsed } from "./vault/search.js";
import { markUsed, newItemId, saveItem } from "./vault/store.js";
import { matchesSite, sameSite } from "./vault/site-match.js";
import { openVault, type OpenVault, isPersonal } from "./vault/decrypt.js";
import type { VaultItem } from "./vault/types.js";

const PENDING_TTL_MS = 5 * 60_000;
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

function pendingKey(tabId: number): string {
  return `autofill:pending:${tabId}`;
}

function identifierKey(tabId: number): string {
  return `autofill:identifier:${tabId}`;
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

function isCard(item: VaultItem): boolean {
  return itemType(item) === "card" && cardDigits(item.cardNumber).length > 0;
}

function isIdentity(item: VaultItem): boolean {
  return itemType(item) === "identity";
}

function cardSuggestionOf(item: VaultItem, vault: OpenVault): CardSuggestion {
  const shared = vault.sharedName(item);
  return {
    id: item.id,
    title: item.title,
    brand: cardBrand(item.cardNumber),
    last4: lastFour(item.cardNumber),
    ...(shared ? { vault: shared } : {}),
  };
}

function identitySuggestionOf(item: VaultItem, vault: OpenVault): IdentitySuggestion {
  const shared = vault.sharedName(item);
  const detail = [item.fullName, item.city].filter(Boolean).join(" · ");
  const country = countryOf(item.country)?.code;
  return {
    id: item.id,
    title: item.title,
    ...(detail ? { detail } : {}),
    ...(country ? { country } : {}),
    ...(shared ? { vault: shared } : {}),
  };
}

function addressDataOf(item: Partial<VaultItem>): AddressData {
  const keys = [
    "fullName",
    "email",
    "phone",
    "company",
    "address",
    "ward",
    "city",
    "region",
    "postalCode",
    "country",
  ] as const;
  return Object.fromEntries(keys.flatMap((key) => (item[key] ? [[key, item[key]]] : [])));
}

function bySiteBound(domain: string) {
  const rank = (item: VaultItem) => (boundToSite(item, domain) ? 0 : 1);
  return (a: VaultItem, b: VaultItem) => rank(a) - rank(b) || byLastUsed(a, b);
}

async function formsAllowed(sender: TrustedSender): Promise<boolean> {
  return isFillableUrl(new URL(sender.url)) && !(await isVaultServer(sender.url));
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
  if (target.protocol !== "https:") {
    return null;
  }
  try {
    const response = await fetch(target, { credentials: "omit", redirect: "error" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|gif|jpeg|webp|svg\+xml)\b/.test(type)) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_QR_IMAGE_BYTES) {
      return null;
    }
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function readPendingTotp(sender: TrustedSender): Promise<PendingTotp | null> {
  const key = totpKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingTotp | undefined;
  if (!pending) {
    return null;
  }
  if (Date.now() - pending.at > PENDING_TTL_MS || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
}

async function readPending(sender: TrustedSender): Promise<PendingCapture | null> {
  const key = pendingKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingCapture | undefined;
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

function bySite(pageUrl: string) {
  const rank = (item: VaultItem) => (sameSite(item, pageUrl) === "exact" ? 0 : 1);
  return (a: VaultItem, b: VaultItem) => rank(a) - rank(b) || byLastUsed(a, b);
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
  return {
    domain: pending.site ?? pending.domain,
    username: pending.username ?? existing?.username,
    password: pending.password,
    update: Boolean(existing),
    confirmed: Boolean(pending.confirmed),
  };
}

async function isVaultServer(url: string): Promise<boolean> {
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
      if (!vault) {
        return { ok: true, locked: true };
      }
      const suggestions = vault.items
        .filter((item) => matchesSite(item, sender.url))
        .sort(bySite(sender.url))
        .map((item) => suggestionOf(item, vault));
      return { ok: true, locked: false, suggestions, domain: sender.domain };
    }

    case "autofill:fill": {
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item?.password || !matchesSite(item, sender.url)) {
        return { ok: false, error: "no_match" };
      }
      void markUsed(vault.key, item).catch(() => {});
      return { ok: true, credentials: { username: item.username, password: item.password } };
    }

    case "autofill:generate":
      return { ok: true, password: generatePassword({ length: 20 }).value };

    case "autofill:identifier": {
      const username = request.username.trim();
      if (username && !(await isVaultServer(sender.url))) {
        const stored: PendingIdentifier = { domain: sender.domain, username, at: Date.now() };
        await chrome.storage.session.set({ [identifierKey(sender.tabId)]: stored });
      }
      return { ok: true, prompt: null };
    }

    case "autofill:capture": {
      if (!request.password || (await isVaultServer(sender.url))) {
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
    }

    case "autofill:pending": {
      const pending = await readPending(sender);
      if (!pending || pending.dismissed) {
        return { ok: true, prompt: null };
      }
      const vault = await openVault();
      return { ok: true, prompt: promptFor(pending, sender.url, vault?.items ?? null) };
    }

    case "autofill:confirm": {
      const pending = await readPending(sender);
      if (!pending) {
        return { ok: true, prompt: null };
      }
      const confirmed = { ...pending, confirmed: true, at: Date.now() };
      await chrome.storage.session.set({ [pendingKey(sender.tabId)]: confirmed });
      const vault = await openVault();
      return { ok: true, prompt: promptFor(confirmed, sender.url, vault?.items ?? null) };
    }

    case "autofill:save": {
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
    }

    case "autofill:dismiss": {
      const pending = await readPending(sender);
      if (pending?.confirmed && !pending.dismissed) {
        await chrome.storage.session.set({
          [pendingKey(sender.tabId)]: { ...pending, dismissed: true },
        });
      } else {
        await chrome.storage.session.remove(pendingKey(sender.tabId));
      }
      return { ok: true, saved: false };
    }

    case "autofill:codes": {
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const suggestions = vault.items
        .filter((item) => item.totp && matchesSite(item, sender.url))
        .sort(byLastUsed)
        .map((item) => suggestionOf(item, vault));
      return { ok: true, locked: false, suggestions, domain: sender.domain };
    }

    case "autofill:code": {
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item?.totp || !matchesSite(item, sender.url)) {
        return { ok: false, error: "no_match" };
      }
      void markUsed(vault.key, item).catch(() => {});
      return { ok: true, code: await currentCode(item.totp) };
    }

    case "autofill:totp-found": {
      if (await isVaultServer(sender.url)) {
        return { ok: true, totp: null };
      }
      let config: TotpConfig;
      try {
        config = parseTotpInput(request.text);
      } catch {
        return { ok: true, totp: null };
      }
      const vault = await openVault();
      const target = vault ? totpTarget(vault.items, sender.url) : undefined;
      if (target?.totp?.secret === config.secret) {
        return { ok: true, totp: null };
      }
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
      if (!pending) {
        return { ok: true, saved: false };
      }
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

    case "autofill:cards": {
      if (!(await formsAllowed(sender))) {
        return { ok: true, locked: false, cards: [] };
      }
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const cards = vault.items
        .filter(isCard)
        .sort(byLastUsed)
        .map((item) => cardSuggestionOf(item, vault));
      return { ok: true, locked: false, cards };
    }

    case "autofill:card": {
      if (!(await formsAllowed(sender))) {
        return { ok: false, error: "no_match" };
      }
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item || !isCard(item)) {
        return { ok: false, error: "no_match" };
      }
      void markUsed(vault.key, item).catch(() => {});
      const card: CardData = {
        number: cardDigits(item.cardNumber),
        brand: cardBrand(item.cardNumber),
        ...(item.cardholder ? { cardholder: item.cardholder } : {}),
        ...(item.cardExpiry ? { expiry: item.cardExpiry } : {}),
        ...(item.cardCvv ? { cvv: item.cardCvv } : {}),
      };
      await fillCardFrames(sender.tabId, sender.url, card);
      return { ok: true, card };
    }

    case "autofill:identities": {
      if (!(await formsAllowed(sender))) {
        return { ok: true, locked: false, identities: [] };
      }
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const identities = vault.items
        .filter(isIdentity)
        .sort(bySiteBound(sender.domain))
        .map((item) => identitySuggestionOf(item, vault));
      return { ok: true, locked: false, identities };
    }

    case "autofill:identity": {
      if (!(await formsAllowed(sender))) {
        return { ok: false, error: "no_match" };
      }
      const vault = await openVault();
      if (!vault) {
        return { ok: true, locked: true };
      }
      const item = vault.items.find((candidate) => candidate.id === request.id);
      if (!item || !isIdentity(item)) {
        return { ok: false, error: "no_match" };
      }
      void markUsed(vault.key, item).catch(() => {});
      return { ok: true, identity: addressDataOf(item) };
    }

    case "autofill:random-address": {
      if (!(await formsAllowed(sender))) {
        return { ok: false, error: "no_match" };
      }
      const country = request.country === "VN" ? "VN" : "US";
      return { ok: true, identity: addressDataOf(generateAddress({ country, email: true })) };
    }

    case "autofill:aliases": {
      if (!(await formsAllowed(sender))) {
        return { ok: true, aliases: [], site: "" };
      }
      const site = registrableDomain(sender.url) ?? sender.domain;
      const tag = aliasTag(site);
      const { email } = await getLocal();
      const vault = await openVault();
      const known = vault
        ? vault.items.filter(isIdentity).flatMap((item) => (item.email ? [item.email] : []))
        : [];
      return {
        ok: true,
        aliases: emailAliases([...(email ? [email] : []), ...known], tag),
        site: tag,
      };
    }

    case "autofill:form-capture":
    case "autofill:form-pending":
    case "autofill:form-save":
    case "autofill:form-dismiss":
      return handleFormRequest(request, sender, await formsAllowed(sender));

    case "autofill:site-check": {
      if (await isVaultServer(sender.url)) {
        return { ok: true, lookalike: null };
      }
      const vault = await openVault();
      if (!vault) {
        return { ok: true, lookalike: null };
      }
      return { ok: true, lookalike: siteWarning(sender.url, vault.items) };
    }

    case "autofill:open-popup":
      await chrome.action.openPopup?.().catch(() => {});
      return { ok: true, saved: false };
  }
}

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

export async function forgetTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove([pendingKey(tabId), identifierKey(tabId), totpKey(tabId)]);
}
