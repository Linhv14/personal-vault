import { describe, expect, it } from "vitest";
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
