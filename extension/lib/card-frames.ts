import { isPaymentFrameUrl } from "../../src/core/payment-frames.js";
import type { CardData } from "./autofill-protocol.js";

const key = (tabId: number) => `cardFrames:${tabId}`;

export async function rememberCardFrame(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (sender.id !== extensionId || tabId === undefined || !sender.frameId) return;
  if (!isPaymentFrameUrl(sender.url)) return;
  try {
    if (new URL(sender.tab?.url ?? "").protocol !== "https:") return;
  } catch {
    return;
  }
  const stored = (await chrome.storage.session.get(key(tabId)))[key(tabId)] as number[] | undefined;
  const frames = new Set(stored ?? []);
  frames.add(sender.frameId);
  await chrome.storage.session.set({ [key(tabId)]: [...frames] });
}

export async function forgetCardFrames(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
}

export async function fillCardFrames(tabId: number, card: CardData): Promise<number> {
  const frames =
    ((await chrome.storage.session.get(key(tabId)))[key(tabId)] as number[] | undefined) ?? [];
  await Promise.all(
    frames.map((frameId) =>
      chrome.tabs
        .sendMessage(tabId, { type: "7key:card-frame-fill", card }, { frameId })
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
  if (sender.id !== extensionId || tabId === undefined || !sender.frameId) return false;
  if (!isPaymentFrameUrl(sender.url)) return false;
  const frames = (await chrome.storage.session.get(key(tabId)))[key(tabId)] as number[] | undefined;
  return frames?.includes(sender.frameId) ?? false;
}
