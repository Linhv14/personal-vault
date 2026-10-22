import { describe, expect, it, vi } from "vitest";
import {
  isCardData,
  isCardFrameCapture,
  isCardFrameFill,
} from "../extension/lib/autofill-protocol.js";

const CARD = { number: "4242424242424242", brand: "visa", expiry: "12/30" };

describe("card frame messages", () => {
  it("accepts the card the background sends", () => {
    expect(isCardData(CARD)).toBe(true);
    expect(isCardData({ ...CARD, cardholder: "A B", cvv: "123" })).toBe(true);
    expect(isCardFrameFill({ type: "7key:card-frame-fill", card: CARD })).toBe(true);
  });

  it.each([
    ["no number", { brand: "visa" }],
    ["an unknown brand", { ...CARD, brand: "toString" }],
    ["a numeric cvv", { ...CARD, cvv: 123 }],
    ["a list", [CARD]],
  ])("rejects a card with %s", (_label, card) => {
    expect(isCardData(card)).toBe(false);
    expect(isCardFrameFill({ type: "7key:card-frame-fill", card })).toBe(false);
  });

  it("rejects a fill message of another type", () => {
    expect(isCardFrameFill({ type: "autofill:fill", card: CARD })).toBe(false);
    expect(isCardFrameFill(null)).toBe(false);
  });

  it("checks the capture a payment frame reports", () => {
    const capture = {
      type: "autofill:card-frame-capture",
      card: { number: "4242" },
      untouched: false,
      submit: true,
    };
    expect(isCardFrameCapture(capture)).toBe(true);
    expect(isCardFrameCapture({ ...capture, card: "4242" })).toBe(false);
    expect(isCardFrameCapture({ ...capture, submit: "yes" })).toBe(false);
    expect(isCardFrameCapture({ ...capture, untouched: undefined })).toBe(false);
  });
});

vi.mock("../extension/lib/autofill/service.js", () => ({
  handleAutofill: vi.fn(async () => {
    throw new Error("internal detail that must not leak");
  }),
}));

vi.mock("../extension/lib/autofill/senders.js", () => ({
  trustedSender: vi.fn(() => ({
    tabId: 1,
    url: "https://example.com/",
    domain: "example.com",
    site: "example.com",
  })),
}));

describe("background message errors", () => {
  it("answers a failed handler with a stable code instead of the error text", async () => {
    type Listener = (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => unknown;
    let onMessage: Listener | null = null;
    const event = { addListener: vi.fn() };
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext",
        onInstalled: event,
        onStartup: event,
        onMessage: {
          addListener: (listener: Listener) => {
            onMessage = listener;
          },
        },
      },
      alarms: { onAlarm: event },
      tabs: { onUpdated: event, onRemoved: event },
      permissions: { onAdded: event, onRemoved: event },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../extension/background.js");
    expect(onMessage).not.toBeNull();

    const reply = await new Promise((resolve) => {
      const keepOpen = onMessage!({ type: "autofill:query" }, { id: "ext" }, resolve);
      expect(keepOpen).toBe(true);
    });
    expect(reply).toEqual({ ok: false, error: "unavailable" });
    vi.unstubAllGlobals();
  });
});
