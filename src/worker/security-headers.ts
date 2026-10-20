export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

export const SHARE_PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export const DEFAULT_SECURITY_CONTACT = "mailto:security@7key.online";
export const SECURITY_POLICY_URL =
  "https://github.com/Linhv14/personal-vault/blob/main/SECURITY.md";
const SECURITY_TXT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export function securityTxt(origin: string, contact: string | undefined, nowMs: number): string {
  const address = contact?.trim() || DEFAULT_SECURITY_CONTACT;
  const expires = new Date(nowMs + SECURITY_TXT_LIFETIME_MS);
  expires.setUTCMilliseconds(0);
  return [
    `Contact: ${/^(mailto:|https:)/.test(address) ? address : `mailto:${address}`}`,
    `Expires: ${expires.toISOString().replace(".000Z", "Z")}`,
    "Preferred-Languages: en, vi",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${SECURITY_POLICY_URL}`,
    "",
  ].join("\n");
}
