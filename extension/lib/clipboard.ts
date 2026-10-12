export const CLIPBOARD_ALARM = "clear-clipboard";
export const CLIPBOARD_CLEAR_SECONDS = 30;
export const CLEAR_CLIPBOARD_MESSAGE = { target: "offscreen", type: "clear-clipboard" } as const;

const OFFSCREEN_PATH = "offscreen/offscreen.html";

export async function scheduleClipboardClear(): Promise<void> {
  await chrome.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: CLIPBOARD_CLEAR_SECONDS / 60 });
}

export async function clearClipboardNow(): Promise<void> {
  if (!chrome.offscreen) return;

  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: "Clear a copied password or 2FA code from the clipboard",
    });
  }

  try {
    await chrome.runtime.sendMessage(CLEAR_CLIPBOARD_MESSAGE);
  } finally {
    await chrome.offscreen.closeDocument();
  }
}

export function isClearClipboardMessage(message: unknown): boolean {
  const candidate = message as Partial<typeof CLEAR_CLIPBOARD_MESSAGE> | null;
  return (
    candidate?.target === CLEAR_CLIPBOARD_MESSAGE.target &&
    candidate.type === CLEAR_CLIPBOARD_MESSAGE.type
  );
}
