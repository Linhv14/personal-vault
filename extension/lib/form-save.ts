import { countryOf } from "../../src/core/address-data.js";
import type {
  AddressData,
  AutofillRequest,
  AutofillResponse,
  CapturedCard,
  CardFrameCapture,
  FormPrompt,
} from "./autofill-protocol.js";
import type { TrustedSender } from "./autofill-service.js";
import { isCardFrame } from "./card-frames.js";
import {
  addressPreview,
  addressWorthSaving,
  boundToSite,
  cleanAddress,
  cleanCard,
  matchCard,
  matchIdentity,
  mergeCards,
  withAddress,
  type CleanCard,
  type Match,
} from "./form-capture.js";
import { CARD_BRAND_NAMES, cardBrand, lastFour } from "./item-types.js";
import { getLocal, setLocal } from "./storage.js";
import {
  isPersonal,
  newItemId,
  openVault,
  registrableDomain,
  saveItem,
  type VaultItem,
} from "./vault.js";

const PENDING_TTL_MS = 5 * 60_000;
const FRAME_TTL_MS = 10 * 60_000;
const MAX_FIELD = 64;

type PendingForm = {
  domain: string;
  at: number;
} & (
  { kind: "card"; card: CleanCard } | { kind: "address"; address: AddressData; random?: boolean }
);

interface FrameParts {
  at: number;
  domain: string;
  parts: Record<string, { card: CapturedCard; untouched: boolean }>;
}

type FormRequest = Extract<
  AutofillRequest,
  {
    type:
      | "autofill:form-capture"
      | "autofill:form-pending"
      | "autofill:form-save"
      | "autofill:form-dismiss";
  }
>;

const pendingKey = (tabId: number) => `autofill:form:${tabId}`;
const framesKey = (tabId: number) => `autofill:frame-card:${tabId}`;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

async function neverAsks(domain: string): Promise<boolean> {
  return ((await getLocal()).neverAskForms ?? []).includes(domain);
}

async function stopAsking(domain: string): Promise<void> {
  const current = (await getLocal()).neverAskForms ?? [];
  if (!current.includes(domain)) {
    await setLocal({ neverAskForms: [...current, domain] });
  }
}

function shortField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_FIELD) : undefined;
}

function sanitizeCard(card: unknown): CapturedCard {
  const raw = (card ?? {}) as Record<string, unknown>;
  const clean: CapturedCard = {};
  for (const key of ["cardholder", "number", "expiry", "cvv"] as const) {
    const value = shortField(raw[key]);
    if (value) {
      clean[key] = value;
    }
  }
  return clean;
}

async function readFrames(tabId: number): Promise<FrameParts | null> {
  const stored = (await chrome.storage.session.get(framesKey(tabId)))[framesKey(tabId)] as
    FrameParts | undefined;
  if (!stored || Date.now() - stored.at > FRAME_TTL_MS) {
    return null;
  }
  return stored;
}

export async function forgetFrameCards(tabId: number): Promise<void> {
  await chrome.storage.session.remove(framesKey(tabId));
}

export async function rememberFrameCard(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  message: CardFrameCapture,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !isHttps(sender.tab?.url ?? "") || !isHttps(sender.url ?? "")) {
    return;
  }
  if (!(await isCardFrame(sender, extensionId))) {
    return;
  }
  const card = sanitizeCard(message.card);
  if (Object.keys(card).length === 0) {
    return;
  }
  const domain = registrableDomain(sender.tab?.url ?? "");
  if (!domain) {
    return;
  }
  const previous = await readFrames(tabId);
  const stored = previous?.domain === domain ? previous : { at: Date.now(), domain, parts: {} };
  stored.parts[String(sender.frameId)] = { card, untouched: message.untouched !== false };
  stored.at = Date.now();
  await chrome.storage.session.set({ [framesKey(tabId)]: stored });
  if (message.submit) {
    await chrome.tabs
      .sendMessage(tabId, { type: "7key:form-capture" }, { frameId: 0 })
      .catch(() => {});
  }
}

async function readPending(sender: TrustedSender): Promise<PendingForm | null> {
  const key = pendingKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingForm | undefined;
  if (!pending) {
    return null;
  }
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending.domain === sender.domain ? pending : null;
}

function personalMatch(match: Match<VaultItem>): Match<VaultItem> {
  return match.status === "changed" && !isPersonal(match.item) ? { status: "same" } : match;
}

function matchOf(pending: PendingForm, items: VaultItem[] | null): Match<VaultItem> {
  if (!items) {
    return { status: "new" };
  }
  return personalMatch(
    pending.kind === "card"
      ? matchCard(items, pending.card)
      : matchIdentity(items, pending.address),
  );
}

function promptOf(pending: PendingForm, items: VaultItem[] | null): FormPrompt | null {
  const match = matchOf(pending, items);
  if (match.status === "same") {
    return null;
  }
  const update = match.status === "changed";
  if (pending.kind === "card") {
    const { card } = pending;
    return {
      kind: "card",
      domain: pending.domain,
      update,
      brand: cardBrand(card.number),
      last4: lastFour(card.number),
      ...(card.expiry ? { expiry: card.expiry } : {}),
      hasCvv: Boolean(card.cvv),
    };
  }
  const country = countryOf(pending.address.country)?.code;
  return {
    kind: "address",
    domain: pending.domain,
    update,
    ...(pending.random ? { random: true } : {}),
    preview: addressPreview(pending.address),
    ...(country ? { country } : {}),
  };
}

async function capture(
  request: Extract<FormRequest, { type: "autofill:form-capture" }>,
  sender: TrustedSender,
): Promise<FormPrompt | null> {
  const frames = await readFrames(sender.tabId);
  if (!isHttps(sender.url) || (await neverAsks(sender.domain))) {
    await forgetFrameCards(sender.tabId);
    return null;
  }
  const parts = frames?.domain === sender.domain ? Object.values(frames.parts) : [];
  const typed = request.untouched === false || parts.some((part) => !part.untouched);
  const card = cleanCard(
    mergeCards([...parts.map((part) => part.card), sanitizeCard(request.card)]),
  );
  let pending: PendingForm | null = null;
  if (card) {
    await forgetFrameCards(sender.tabId);
    if (typed) {
      pending = { kind: "card", card, domain: sender.domain, at: Date.now() };
    }
  } else if (request.address) {
    const address = cleanAddress(request.address);
    if (addressWorthSaving(address, request.random)) {
      pending = {
        kind: "address",
        address,
        ...(request.random ? { random: true } : {}),
        domain: sender.domain,
        at: Date.now(),
      };
    }
  }
  if (!pending) {
    return null;
  }
  const vault = await openVault();
  const prompt = promptOf(pending, vault?.items ?? null);
  if (prompt) {
    await chrome.storage.session.set({ [pendingKey(sender.tabId)]: pending });
  } else {
    await chrome.storage.session.remove(pendingKey(sender.tabId));
  }
  return prompt;
}

function cardTitle(card: CleanCard): string {
  const brand = CARD_BRAND_NAMES[cardBrand(card.number)];
  return [brand, `•••• ${lastFour(card.number)}`].filter(Boolean).join(" ");
}

function bindSite(item: VaultItem, domain: string): VaultItem {
  if (boundToSite(item, domain)) {
    return item;
  }
  if (!item.url) {
    return { ...item, url: domain };
  }
  return { ...item, urls: [...(item.urls ?? []), domain] };
}

function itemToSave(
  pending: PendingForm,
  match: Match<VaultItem>,
  withCvv: boolean,
): Omit<VaultItem, "createdAt" | "updatedAt"> {
  if (pending.kind === "card") {
    const { card } = pending;
    const cvv = withCvv && card.cvv ? { cardCvv: card.cvv } : {};
    if (match.status === "changed") {
      return {
        ...match.item,
        ...(card.expiry ? { cardExpiry: card.expiry } : {}),
        ...(card.cardholder ? { cardholder: card.cardholder } : {}),
        ...cvv,
      };
    }
    return {
      id: newItemId(),
      type: "card",
      title: cardTitle(card),
      cardNumber: card.number,
      ...(card.expiry ? { cardExpiry: card.expiry } : {}),
      ...(card.cardholder ? { cardholder: card.cardholder } : {}),
      ...cvv,
    };
  }
  const { address, domain } = pending;
  if (match.status === "changed") {
    const updated = withAddress(match.item, address);
    return pending.random ? bindSite(updated, domain) : updated;
  }
  const street = address.address?.split("\n")[0];
  return {
    id: newItemId(),
    type: "identity",
    title: pending.random ? domain : (address.fullName ?? street ?? domain),
    ...(pending.random ? { url: domain } : {}),
    ...address,
  };
}

async function save(sender: TrustedSender, withCvv: boolean): Promise<AutofillResponse> {
  const pending = await readPending(sender);
  if (!pending) {
    return { ok: true, saved: false };
  }
  const vault = await openVault();
  if (!vault) {
    await chrome.action.openPopup?.().catch(() => {});
    return { ok: true, saved: false, locked: true };
  }
  const match = matchOf(pending, vault.items);
  if (match.status !== "same") {
    await saveItem(
      vault.key,
      itemToSave(pending, match, withCvv),
      match.status === "changed" ? match.item : undefined,
    );
  }
  await chrome.storage.session.remove(pendingKey(sender.tabId));
  return { ok: true, saved: true };
}

export async function handleFormRequest(
  request: FormRequest,
  sender: TrustedSender,
  allowed: boolean,
): Promise<AutofillResponse> {
  switch (request.type) {
    case "autofill:form-capture":
      return { ok: true, form: allowed ? await capture(request, sender) : null };

    case "autofill:form-pending": {
      const pending = allowed ? await readPending(sender) : null;
      if (!pending) {
        return { ok: true, form: null };
      }
      const vault = await openVault();
      return { ok: true, form: promptOf(pending, vault?.items ?? null) };
    }

    case "autofill:form-save":
      if (!allowed) {
        return { ok: true, saved: false };
      }
      return save(sender, request.cvv === true);

    case "autofill:form-dismiss":
      await chrome.storage.session.remove(pendingKey(sender.tabId));
      if (request.never) {
        await stopAsking(sender.domain);
      }
      return { ok: true, saved: false };
  }
}
