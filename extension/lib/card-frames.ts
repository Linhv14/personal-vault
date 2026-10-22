import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { CardData } from "./autofill-protocol.js";

interface CardFrame {
  frameId: number;
  documentId: string;
}

const key = (tabId: number) => `cardFrames:${tabId}`;

function isHttps(raw: string | undefined): boolean {
  try {
    return new URL(raw ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

async function storedFrames(tabId: number): Promise<CardFrame[]> {
  const stored: unknown = (await chrome.storage.session.get(key(tabId)))[key(tabId)];
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (entry): entry is CardFrame =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as CardFrame).frameId === "number" &&
      typeof (entry as CardFrame).documentId === "string",
  );
}

export async function rememberCardFrame(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<void> {
  const tabId = sender.tab?.id;
  const { frameId, documentId } = sender;
  if (sender.id !== extensionId || tabId === undefined || !frameId || !documentId) {
    return;
  }
  if (!isPaymentFrameUrl(sender.url) || !isHttps(sender.tab?.url)) {
    return;
  }
  const frames = (await storedFrames(tabId)).filter((frame) => frame.frameId !== frameId);
  frames.push({ frameId, documentId });
  await chrome.storage.session.set({ [key(tabId)]: frames });
}

export async function forgetCardFrames(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
}

export async function fillCardFrames(
  tabId: number,
  topUrl: string,
  card: CardData,
): Promise<number> {
  if (!isHttps(topUrl)) {
    return 0;
  }
  const frames = await storedFrames(tabId);
  await Promise.all(
    frames.map(({ documentId }) =>
      chrome.tabs
        .sendMessage(tabId, { type: "7key:card-frame-fill", card }, { documentId })
        .catch(() => {}),
    ),
  );
  return frames.length;
}

export async function isCardFrame(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<boolean> {
  const tabId = sender.tab?.id;
  const { frameId, documentId } = sender;
  if (sender.id !== extensionId || tabId === undefined || !frameId || !documentId) {
    return false;
  }
  if (!isPaymentFrameUrl(sender.url)) {
    return false;
  }
  return (await storedFrames(tabId)).some(
    (frame) => frame.frameId === frameId && frame.documentId === documentId,
  );
}
