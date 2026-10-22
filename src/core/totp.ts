import { base32Decode, base32Encode, isValidBase32 } from "./base32.js";
import { randomBytes } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { VaultError } from "./errors.js";
import { isPlainObject } from "./json.js";

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpConfig {
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer?: string;
  account?: string;
}

export const TOTP_DEFAULTS = {
  algorithm: "SHA-1" as TotpAlgorithm,
  digits: 6,
  period: 30,
};

const ALGORITHMS: readonly unknown[] = ["SHA-1", "SHA-256", "SHA-512"];

function optional<T>(value: unknown, check: (value: unknown) => value is T): boolean {
  return value === undefined || check(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const isAlgorithm = (value: unknown): value is TotpAlgorithm => ALGORITHMS.includes(value);

export function parseTotpConfig(value: unknown): TotpConfig | null {
  if (
    !isPlainObject(value) ||
    typeof value.secret !== "string" ||
    !optional(value.algorithm, isAlgorithm) ||
    !optional(value.digits, isPositiveInteger) ||
    !optional(value.period, isPositiveInteger) ||
    !optional(value.issuer, isString) ||
    !optional(value.account, isString)
  ) {
    return null;
  }
  const { algorithm, digits, period, issuer, account } = value;
  return {
    secret: value.secret,
    algorithm: isAlgorithm(algorithm) ? algorithm : TOTP_DEFAULTS.algorithm,
    digits: isPositiveInteger(digits) ? digits : TOTP_DEFAULTS.digits,
    period: isPositiveInteger(period) ? period : TOTP_DEFAULTS.period,
    ...(isString(issuer) ? { issuer } : {}),
    ...(isString(account) ? { account } : {}),
  };
}

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

  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export function secondsRemaining(period = TOTP_DEFAULTS.period, atMs = Date.now()): number {
  return period - (Math.floor(atMs / 1000) % period);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

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
  if (url.host.toLowerCase() !== "totp") {
    throw new VaultError("totp.not_totp", {}, `Unsupported otpauth type: ${url.host}`);
  }

  const secret = url.searchParams.get("secret");
  if (!secret || !isValidBase32(secret)) {
    throw new VaultError("totp.missing_secret", {}, "Missing or malformed secret parameter");
  }

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
