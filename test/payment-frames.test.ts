import { describe, expect, it } from "vitest";
import { isPaymentFrameUrl } from "../src/core/payment-frames.js";

describe("payment frames", () => {
  it("accepts the hosted card field frames of known payment providers over https", () => {
    for (const url of [
      "https://checkout.pci.shopifyinc.com/build/x/number-ltr.html",
      "https://js.stripe.com/v3/elements-inner-card.html",
      "https://b.js.stripe.com/v3/elements-inner-card.html",
      "https://assets.braintreegateway.com/web/hosted-fields.html",
      "https://web.squarecdn.com/v1/square.js",
      "https://sandbox.web.squarecdn.com/v1/square.js",
      "https://js.mollie.com/v1/components",
      "https://accept.authorize.net/payment/payment",
      "https://test.authorize.net/payment/payment",
    ]) {
      expect(isPaymentFrameUrl(url), url).toBe(true);
    }
  });

  it("refuses provider domains that serve other content", () => {
    for (const url of [
      "https://www.paypal.com/checkoutnow",
      "https://squareup.com/frame",
      "https://www.checkout.com/frame",
      "https://merchant.chargebee.com/hp_v3",
      "https://checkoutshopper-live.adyen.com/frame",
      "https://evil.braintreegateway.com/frame",
      "https://stripe.com/frame",
      "https://a.b.js.stripe.com/frame",
      "https://evil.pci.shopifyinc.com/frame",
      "https://www.authorize.net/frame",
    ]) {
      expect(isPaymentFrameUrl(url), url).toBe(false);
    }
  });

  it("refuses other origins, look-alikes and plain http", () => {
    expect(isPaymentFrameUrl("https://ads.example.com/frame.html")).toBe(false);
    expect(isPaymentFrameUrl("https://stripe.com.evil.io/frame")).toBe(false);
    expect(isPaymentFrameUrl("https://js.stripe.com.evil.io/frame")).toBe(false);
    expect(isPaymentFrameUrl("https://evil-js.stripe.com/frame")).toBe(false);
    expect(isPaymentFrameUrl("http://js.stripe.com/v3/")).toBe(false);
    expect(isPaymentFrameUrl(undefined)).toBe(false);
  });
});
