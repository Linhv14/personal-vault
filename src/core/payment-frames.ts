const PAYMENT_FRAME_HOSTS = new Set([
  "checkout.pci.shopifyinc.com",
  "js.stripe.com",
  "assets.braintreegateway.com",
  "web.squarecdn.com",
  "sandbox.web.squarecdn.com",
  "js.mollie.com",
  "accept.authorize.net",
  "test.authorize.net",
]);

const PAYMENT_FRAME_PARENTS = ["js.stripe.com"];

export function isPaymentFrameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    PAYMENT_FRAME_HOSTS.has(host) ||
    PAYMENT_FRAME_PARENTS.some(
      (parent) =>
        /^[a-z0-9-]+$/.test(host.slice(0, -parent.length - 1)) && host.endsWith(`.${parent}`),
    )
  );
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
