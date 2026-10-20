import { describe, expect, it } from "vitest";
import { isPaymentFrameUrl } from "../src/core/payment-frames.js";

describe("payment frames", () => {
  it("accepts the card iframes of known payment providers over https", () => {
    expect(isPaymentFrameUrl("https://checkout.pci.shopifyinc.com/build/x/number-ltr.html")).toBe(
      true,
    );
    expect(isPaymentFrameUrl("https://js.stripe.com/v3/elements-inner-card.html")).toBe(true);
    expect(isPaymentFrameUrl("https://assets.braintreegateway.com/web/hosted-fields.html")).toBe(
      true,
    );
  });

  it("refuses other origins, look-alikes and plain http", () => {
    expect(isPaymentFrameUrl("https://ads.example.com/frame.html")).toBe(false);
    expect(isPaymentFrameUrl("https://stripe.com.evil.io/frame")).toBe(false);
    expect(isPaymentFrameUrl("https://notpaypal.com/frame")).toBe(false);
    expect(isPaymentFrameUrl("http://js.stripe.com/v3/")).toBe(false);
    expect(isPaymentFrameUrl(undefined)).toBe(false);
  });
});
