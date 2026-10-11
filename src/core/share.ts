/**
 * Mã hoá cho link share.
 *
 * Nguyên tắc: khoá nằm trong fragment của URL (`#...`), phần mà browser **không**
 * gửi lên server. Worker chỉ giữ ciphertext. Kể cả khi toàn bộ D1 bị lộ, không có
 * link thì không giải mã được gì.
 *
 * Giới hạn còn lại: gửi link qua Zalo/Messenger thì nền tảng đó đọc được cả
 * fragment, vì với họ link chỉ là một đoạn text. Đó là lý do có tuỳ chọn mật khẩu
 * phụ bên dưới — báo nó cho người nhận qua kênh khác thì một kênh bị đọc vẫn
 * không đủ để mở.
 */

import { fromBase64Url, randomBytes, toBase64Url, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { open, seal, type SealedData } from "./crypto.js";
import type { TotpConfig } from "./totp.js";

export interface SharePayload {
  title?: string;
  url?: string;
  username?: string;
  password?: string;
  note?: string;
  totp?: TotpConfig;
}

export interface CreatedShare {
  sealed: SealedData;
  /** Chuỗi để đặt sau dấu `#` trong link. Không bao giờ gửi lên server. */
  fragment: string;
}

/** Hậu tố đánh dấu link cần mật khẩu phụ, để trang nhận biết mà hỏi trước. */
const PASSPHRASE_MARKER = ".p";

/**
 * Dẫn xuất khoá thật từ khoá trong link và mật khẩu phụ (nếu có).
 *
 * Dùng HKDF với mật khẩu phụ làm salt: cần **cả hai** mới ra đúng khoá. Mật khẩu
 * phụ ở đây không cần mạnh như master password, vì khoá trong link đã mang 256
 * bit entropy — nó chỉ đóng vai trò yếu tố thứ hai, không phải nguồn entropy.
 */
async function deriveShareKey(keyMaterial: Bytes, passphrase?: string): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: passphrase ? utf8Encode(passphrase) : new Uint8Array(0),
      info: utf8Encode("share"),
    },
    hkdfKey,
    256,
  );
  return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function createShare(
  payload: SharePayload,
  passphrase?: string,
): Promise<CreatedShare> {
  const keyMaterial = randomBytes(32);
  const key = await deriveShareKey(keyMaterial, passphrase);
  const sealed = await seal(key, utf8Encode(JSON.stringify(payload)));

  return {
    sealed,
    fragment: toBase64Url(keyMaterial) + (passphrase ? PASSPHRASE_MARKER : ""),
  };
}

/** Trang nhận link gọi hàm này để biết có cần hỏi mật khẩu phụ không. */
export function fragmentNeedsPassphrase(fragment: string): boolean {
  return stripHash(fragment).endsWith(PASSPHRASE_MARKER);
}

export async function openShare(
  fragment: string,
  sealed: SealedData,
  passphrase?: string,
): Promise<SharePayload> {
  const raw = stripHash(fragment);
  const needsPassphrase = raw.endsWith(PASSPHRASE_MARKER);
  const keyPart = needsPassphrase ? raw.slice(0, -PASSPHRASE_MARKER.length) : raw;

  if (needsPassphrase && !passphrase) {
    throw new Error("Link này cần mật khẩu phụ");
  }

  let keyMaterial: Bytes;
  try {
    keyMaterial = fromBase64Url(keyPart);
  } catch {
    throw new Error("Khoá trong link không hợp lệ");
  }
  if (keyMaterial.length !== 32) throw new Error("Khoá trong link không hợp lệ");

  const key = await deriveShareKey(keyMaterial, needsPassphrase ? passphrase : undefined);

  let plaintext: Bytes;
  try {
    plaintext = await open(key, sealed);
  } catch {
    // GCM tag không khớp. Với link cần mật khẩu phụ thì gần như luôn là nhập sai.
    throw new Error(
      needsPassphrase ? "Mật khẩu phụ không đúng" : "Không giải mã được — link có thể bị cắt ngắn",
    );
  }

  return JSON.parse(new TextDecoder().decode(plaintext)) as SharePayload;
}

function stripHash(fragment: string): string {
  return fragment.startsWith("#") ? fragment.slice(1) : fragment;
}

export function buildShareUrl(origin: string, id: string, fragment: string): string {
  return `${origin.replace(/\/$/, "")}/s/${id}#${fragment}`;
}
