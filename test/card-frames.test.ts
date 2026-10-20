import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillCardFrames,
  forgetCardFrames,
  rememberCardFrame,
} from "../extension/lib/card-frames.js";

const EXTENSION = "extension-id";
const CARD = { number: "4242424242424242", brand: "visa" as const };
let store: Record<string, unknown>;
const sendMessage = vi.fn(async () => undefined);

beforeEach(() => {
  store = {};
  sendMessage.mockClear();
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (name: string) => ({ [name]: store[name] }),
        set: async (values: Record<string, unknown>) => Object.assign(store, values),
        remove: async (name: string) => delete store[name],
      },
    },
    tabs: { sendMessage },
  });
});

function frameSender(
  overrides: Partial<chrome.runtime.MessageSender> = {},
): chrome.runtime.MessageSender {
  return {
    id: EXTENSION,
    tab: { id: 7, url: "https://shop.example/checkout" } as chrome.tabs.Tab,
    frameId: 3,
    documentId: "doc-a",
    url: "https://js.stripe.com/v3/elements-inner-card.html",
    ...overrides,
  };
}

describe("card frames", () => {
  it("sends the card only to the registered payment document of an https page", async () => {
    await rememberCardFrame(frameSender(), EXTENSION);
    expect(await fillCardFrames(7, "https://shop.example/checkout", CARD)).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      { type: "7key:card-frame-fill", card: CARD },
      { documentId: "doc-a" },
    );
  });

  it("sends nothing when the top page is not https", async () => {
    await rememberCardFrame(frameSender(), EXTENSION);
    expect(await fillCardFrames(7, "http://shop.example/checkout", CARD)).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores frames outside the allowlist, on http pages, or without a document", async () => {
    await rememberCardFrame(frameSender({ url: "https://ads.example/frame" }), EXTENSION);
    await rememberCardFrame(
      frameSender({ tab: { id: 7, url: "http://shop.example" } as chrome.tabs.Tab }),
      EXTENSION,
    );
    await rememberCardFrame(frameSender({ documentId: undefined }), EXTENSION);
    await rememberCardFrame(frameSender({ frameId: 0 }), EXTENSION);
    await rememberCardFrame(frameSender({ id: "other" }), EXTENSION);
    expect(await fillCardFrames(7, "https://shop.example/checkout", CARD)).toBe(0);
  });

  it("follows the frame's newest document instead of whatever it navigated to", async () => {
    await rememberCardFrame(frameSender(), EXTENSION);
    await rememberCardFrame(frameSender({ documentId: "doc-b" }), EXTENSION);
    await fillCardFrames(7, "https://shop.example/checkout", CARD);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(7, expect.anything(), { documentId: "doc-b" });
  });

  it("drops frames registered with the old frame-id-only format", async () => {
    store["cardFrames:7"] = [3, 4];
    expect(await fillCardFrames(7, "https://shop.example/checkout", CARD)).toBe(0);
    await forgetCardFrames(7);
    expect(store["cardFrames:7"]).toBeUndefined();
  });
});
