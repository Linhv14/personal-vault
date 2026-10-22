/**
 * TOTP per RFC 6238 (built on HOTP, RFC 4226).
 *
 * Every computation here is offline: a code depends only on the secret and the
 * current time. The server never needs to know the secret, and that is exactly
 * why this replaces the authenticator app on your phone.
 */

import { base32Decode, base32Encode, isValidBase32 } from "./base32.js";
import { randomBytes } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { VaultError } from "./errors.js";

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpConfig {
  secret: string; // base32
  algorithm: TotpAlgorithm;
  digits: number;
  period: number; // seconds
  issuer?: string;
  account?: string;
}

export const TOTP_DEFAULTS = {
  algorithm: "SHA-1" as TotpAlgorithm,
  digits: 6,
  period: 30,
};

/**
 * Defaults to SHA-1. That sounds obsolete, but RFC 6238 specifies it and nearly
 * every site uses it. SHA-1 is broken for collision resistance, not inside an
 * HMAC — so it is still sound here. Switching to SHA-256 would produce codes the
 * site rejects.
 */
export async function generateTotp(
  config: Pick<TotpConfig, "secret"> & Partial<TotpConfig>,
  atMs: number = Date.now(),
): Promise<string> {
  const algorithm = config.algorithm ?? TOTP_DEFAULTS.algorithm;
  const digits = config.digits ?? TOTP_DEFAULTS.digits;
  const period = config.period ?? TOTP_DEFAULTS.period;

  const key = base32Decode(config.secret);
  if (key.length === 0) {
    throw new VaultError("totp.empty_secret", {}, "TOTP secret is empty");
  }

  const counter = Math.floor(atMs / 1000 / period);
  return hotp(key, counter, algorithm, digits);
}

async function hotp(
  key: Bytes,
  counter: number,
  algorithm: TotpAlgorithm,
  digits: number,
): Promise<string> {
  // The counter is a 64-bit big-endian integer. It only exceeds 32 bits in the
  // year 6053, but BigInt avoids JavaScript's bit-shift wraparound at 2^31
  // regardless.
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));

  // Dynamic truncation (RFC 4226 §5.3): the low 4 bits of the last byte say
  // where to read from. Index by actual MAC length so SHA-256/512 work too.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | // clear the sign bit to avoid a negative
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Seconds until the code rolls over — drives the countdown ring. */
export function secondsRemaining(period = TOTP_DEFAULTS.period, atMs = Date.now()): number {
  return period - (Math.floor(atMs / 1000) % period);
}

/**
 * Generate a fresh secret. 20 bytes = 160 bits, the key length RFC 4226
 * recommends for HMAC-SHA1, which encodes to 32 base32 characters.
 */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * Parse the `otpauth://` URI found in a QR code.
 * Shape: otpauth://totp/Issuer:account@x.com?secret=BASE32&issuer=Issuer&digits=6
 */
export function parseOtpauthUri(uri: string): TotpConfig {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new VaultError("totp.invalid_uri", {}, `Not a valid URI: ${uri.slice(0, 40)}`);
  }

  if (url.protocol !== "otpauth:") {
    throw new VaultError("totp.invalid_uri", {}, `Expected otpauth:, got ${url.protocol}`);
  }
  // `url.host` of otpauth://totp/... is "totp". HOTP is counter-based: it needs
  // persisted state that increments, so it cannot share this code path.
  if (url.host.toLowerCase() !== "totp") {
    throw new VaultError("totp.not_totp", {}, `Unsupported otpauth type: ${url.host}`);
  }

  const secret = url.searchParams.get("secret");
  if (!secret || !isValidBase32(secret)) {
    throw new VaultError("totp.missing_secret", {}, "Missing or malformed secret parameter");
  }

  // The label is "Issuer:account" and may be percent-encoded. When present, the
  // `issuer` parameter wins over the label prefix, as Google recommends.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : undefined;
  const account = colon >= 0 ? label.slice(colon + 1).trim() : label.trim();

  const rawAlgorithm = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  const algorithm = normalizeAlgorithm(rawAlgorithm);

  const digits = Number.parseInt(url.searchParams.get("digits") ?? "", 10);
  const period = Number.parseInt(url.searchParams.get("period") ?? "", 10);

  return {
    secret: secret.replace(/[\s-]/g, "").toUpperCase(),
    algorithm,
    digits: Number.isFinite(digits) && digits >= 6 && digits <= 10 ? digits : TOTP_DEFAULTS.digits,
    period: Number.isFinite(period) && period > 0 ? period : TOTP_DEFAULTS.period,
    issuer: url.searchParams.get("issuer")?.trim() || labelIssuer,
    account: account || undefined,
  };
}

function normalizeAlgorithm(raw: string): TotpAlgorithm {
  switch (raw.replace("-", "")) {
    case "SHA1":
      return "SHA-1";
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    default:
      throw new VaultError(
        "totp.unsupported_algorithm",
        { algorithm: raw },
        `Unsupported algorithm: ${raw}`,
      );
  }
}

export function buildOtpauthUri(config: TotpConfig): string {
  const label = config.issuer
    ? `${config.issuer}:${config.account ?? ""}`
    : (config.account ?? "account");

  const params = new URLSearchParams({
    secret: config.secret,
    algorithm: config.algorithm.replace("-", ""),
    digits: String(config.digits),
    period: String(config.period),
  });
  if (config.issuer) {
    params.set("issuer", config.issuer);
  }

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Accept whatever the user pasted — an otpauth URI or a bare base32 secret — and
 * return a config. One funnel so all three entry paths (typing, QR scan, URI)
 * behave identically.
 */
export function parseTotpInput(input: string, fallbackAccount?: string): TotpConfig {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    return parseOtpauthUri(trimmed);
  }
  if (!isValidBase32(trimmed)) {
    throw new VaultError("totp.unrecognized_input", {}, "Neither an otpauth URI nor base32");
  }
  return {
    secret: trimmed.replace(/[\s-]/g, "").toUpperCase(),
    ...TOTP_DEFAULTS,
    account: fallbackAccount,
  };
}
