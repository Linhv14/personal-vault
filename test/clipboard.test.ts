import { beforeEach, describe, expect, it, vi } from "vitest";

const contexts: unknown[] = [];
const alarmsCreate = vi.fn(async () => {});
const createDocument = vi.fn(async () => {});
const closeDocument = vi.fn(async () => {});
const sendMessage = vi.fn(async (_message: unknown): Promise<unknown> => undefined);
const getContexts = vi.fn(async () => contexts);

const offscreen = {
  createDocument,
  closeDocument,
  Reason: { CLIPBOARD: "CLIPBOARD" },
};

const chromeStub: Record<string, unknown> = {
  alarms: { create: alarmsCreate },
  offscreen,
  runtime: {
    ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
    getURL: (path: string) => `chrome-extension://abc/${path}`,
    getContexts,
    sendMessage,
  },
};
vi.stubGlobal("chrome", chromeStub);

const {
  CLEAR_CLIPBOARD_MESSAGE,
  CLIPBOARD_ALARM,
  clearClipboardNow,
  isClearClipboardMessage,
  scheduleClipboardClear,
} = await import("../extension/lib/clipboard.js");

beforeEach(() => {
  vi.clearAllMocks();
  contexts.length = 0;
  chromeStub.offscreen = offscreen;
  sendMessage.mockImplementation(async () => undefined);
});

describe("clipboard clearing", () => {
  it("schedules the clear thirty seconds out", async () => {
    await scheduleClipboardClear();
    expect(alarmsCreate).toHaveBeenCalledWith(CLIPBOARD_ALARM, { delayInMinutes: 0.5 });
  });

  it("opens an offscreen document, asks it to clear, and closes it", async () => {
    await clearClipboardNow();
    expect(getContexts).toHaveBeenCalledWith({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: ["chrome-extension://abc/offscreen/offscreen.html"],
    });
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "offscreen/offscreen.html", reasons: ["CLIPBOARD"] }),
    );
    expect(sendMessage).toHaveBeenCalledWith(CLEAR_CLIPBOARD_MESSAGE);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it("reuses an offscreen document that is already open", async () => {
    contexts.push({ contextType: "OFFSCREEN_DOCUMENT" });
    await clearClipboardNow();
    expect(createDocument).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it("still closes the document when the clear message fails", async () => {
    sendMessage.mockRejectedValueOnce(new Error("no receiver"));
    await expect(clearClipboardNow()).rejects.toThrow("no receiver");
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the offscreen API is missing", async () => {
    chromeStub.offscreen = undefined;
    await expect(clearClipboardNow()).resolves.toBeUndefined();
    expect(getContexts).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("isClearClipboardMessage", () => {
  it("matches only the exact offscreen clear message", () => {
    expect(isClearClipboardMessage(CLEAR_CLIPBOARD_MESSAGE)).toBe(true);
    expect(isClearClipboardMessage({ ...CLEAR_CLIPBOARD_MESSAGE, extra: 1 })).toBe(true);
    for (const other of [
      null,
      undefined,
      "clear-clipboard",
      42,
      [],
      {},
      { target: "offscreen" },
      { type: "clear-clipboard" },
      { target: "background", type: "clear-clipboard" },
      { target: "offscreen", type: "copy" },
      { target: "OFFSCREEN", type: "clear-clipboard" },
    ]) {
      expect(isClearClipboardMessage(other)).toBe(false);
    }
  });
});
