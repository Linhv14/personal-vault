const PAYMENT_FRAME_SUFFIXES = [
  "pci.shopifyinc.com",
  "js.stripe.com",
  "braintreegateway.com",
  "braintree-api.com",
  "adyen.com",
  "adyenpayments.com",
  "squarecdn.com",
  "squareup.com",
  "checkout.com",
  "paypal.com",
  "recurly.com",
  "chargebee.com",
  "mollie.com",
  "authorize.net",
  "worldpay.com",
  "paddle.com",
  "2checkout.com",
];

export function isPaymentFrameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PAYMENT_FRAME_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isPaymentFrameUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && isPaymentFrameHost(url.hostname);
  } catch {
    return false;
  }
}
