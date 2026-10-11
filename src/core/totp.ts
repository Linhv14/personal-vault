/**
 * TOTP theo RFC 6238 (dựa trên HOTP, RFC 4226).
 *
 * Toàn bộ phép tính chạy offline: mã chỉ phụ thuộc vào `secret` và thời gian
 * hiện tại. Server không bao giờ cần biết secret, và đó chính là lý do ta bỏ
 * được app 2FA trên điện thoại.
 */

import { base32Decode, base32Encode, isValidBase32 } from "./base32.js";
import { randomBytes } from "./bytes.js";
import type { Bytes } from "./bytes.js";

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpConfig {
  secret: string; // base32
  algorithm: TotpAlgorithm;
  digits: number;
  period: number; // giây
  issuer?: string;
  account?: string;
}

export const TOTP_DEFAULTS = {
  algorithm: "SHA-1" as TotpAlgorithm,
  digits: 6,
  period: 30,
};

/**
 * Mặc định là SHA-1. Nghe như lỗi thời, nhưng RFC 6238 chốt vậy và gần như mọi
 * site đều dùng nó. SHA-1 chỉ yếu với tấn công va chạm, không yếu khi dùng trong
 * HMAC — nên vẫn an toàn ở đây. Đổi sang SHA-256 sẽ ra mã không khớp với site.
 */
export async function generateTotp(
  config: Pick<TotpConfig, "secret"> & Partial<TotpConfig>,
  atMs: number = Date.now(),
): Promise<string> {
  const algorithm = config.algorithm ?? TOTP_DEFAULTS.algorithm;
  const digits = config.digits ?? TOTP_DEFAULTS.digits;
  const period = config.period ?? TOTP_DEFAULTS.period;

  const key = base32Decode(config.secret);
  if (key.length === 0) throw new Error("TOTP secret rỗng");

  const counter = Math.floor(atMs / 1000 / period);
  return hotp(key, counter, algorithm, digits);
}

async function hotp(
  key: Bytes,
  counter: number,
  algorithm: TotpAlgorithm,
  digits: number,
): Promise<string> {
  // Counter là số nguyên 64-bit big-endian. `counter` vượt quá 32 bit vào năm
  // 6053 nên dùng BigInt cho chắc, tránh lỗi dịch bit của JS ở mốc 2^31.
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

  // Dynamic truncation (RFC 4226 §5.3): 4 bit cuối của byte cuối cho biết đọc
  // từ đâu. Lấy byte cuối theo độ dài thật của MAC để SHA-256/512 cũng đúng.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | // bỏ bit dấu, tránh số âm
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Số giây còn lại trước khi mã đổi — dùng vẽ vòng đếm ngược. */
export function secondsRemaining(period = TOTP_DEFAULTS.period, atMs = Date.now()): number {
  return period - (Math.floor(atMs / 1000) % period);
}

/**
 * Sinh secret mới. 20 byte = 160 bit, đúng độ dài khoá khuyến nghị của RFC 4226
 * cho HMAC-SHA1, và ra chuỗi base32 32 ký tự.
 */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * Parse URI `otpauth://` trong QR code.
 * Dạng: otpauth://totp/Issuer:account@x.com?secret=BASE32&issuer=Issuer&digits=6
 */
export function parseOtpauthUri(uri: string): TotpConfig {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new Error("URI không hợp lệ");
  }

  if (url.protocol !== "otpauth:") {
    throw new Error(`Chỉ hỗ trợ otpauth://, nhận được "${url.protocol}"`);
  }
  // `url.host` của otpauth://totp/... là "totp". HOTP (counter-based) cần lưu
  // thêm counter và tự tăng, không dùng được chung đường với TOTP.
  if (url.host.toLowerCase() !== "totp") {
    throw new Error("Chỉ hỗ trợ TOTP, không hỗ trợ HOTP");
  }

  const secret = url.searchParams.get("secret");
  if (!secret || !isValidBase32(secret)) {
    throw new Error("Thiếu hoặc sai tham số secret");
  }

  // Label là "Issuer:account", có thể đã URL-encode. Tham số `issuer` nếu có thì
  // ưu tiên hơn phần issuer trong label, theo khuyến nghị của Google.
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
      throw new Error(`Thuật toán không hỗ trợ: ${raw}`);
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
  if (config.issuer) params.set("issuer", config.issuer);

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Nhận vào thứ người dùng dán — URI otpauth hoặc chuỗi base32 trần — và trả về
 * config. Gom một chỗ để cả ba đường nhập (dán tay, quét QR, dán URI) đi chung.
 */
export function parseTotpInput(input: string, fallbackAccount?: string): TotpConfig {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    return parseOtpauthUri(trimmed);
  }
  if (!isValidBase32(trimmed)) {
    throw new Error("Không phải URI otpauth cũng không phải chuỗi base32 hợp lệ");
  }
  return {
    secret: trimmed.replace(/[\s-]/g, "").toUpperCase(),
    ...TOTP_DEFAULTS,
    account: fallbackAccount,
  };
}
