/**
 * Lớp mật mã của vault. Chỉ dùng WebCrypto, không dependency ngoài — một app giữ
 * toàn bộ mật khẩu thì mỗi thư viện bên thứ ba là một chỗ có thể bị cài mã độc.
 *
 * Luồng khoá (xem docs/plans/2026-10-11-personal-vault-design.md §2):
 *
 *   master password + email
 *        -> PBKDF2-SHA256 600k  -> master key
 *        -> HKDF info="auth"    -> auth key        (gửi server)
 *        -> HKDF info="enc"     -> wrapping key    (không rời client)
 *                               -> mở wrapped_vault_key -> vault key
 *                               -> AES-256-GCM từng item
 */

import { concat, fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";

export type KdfType = "pbkdf2-sha256";

export interface KdfParams {
  type: KdfType;
  iterations: number;
  salt: string; // base64
}

/**
 * 600.000 vòng là mặc định hiện tại của Bitwarden và mức OWASP khuyến nghị cho
 * PBKDF2-SHA256. Trên máy tính thường mất ~0,5–1 giây, chấp nhận được khi unlock.
 */
export const DEFAULT_KDF_ITERATIONS = 600_000;

/** AES-GCM yêu cầu nonce 96 bit; đây là độ dài duy nhất được khuyến nghị. */
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export interface SealedData {
  ciphertext: string; // base64
  nonce: string; // base64
}

/** Những gì server lưu cho một account. Không có gì ở đây giải mã được vault. */
export interface AccountCryptoRecord {
  kdf: KdfParams;
  authKey: string; // base64 — server sẽ hash lại trước khi lưu
  wrappedVaultKey: SealedData;
}

// ---------------------------------------------------------------------------
// Dẫn xuất khoá
// ---------------------------------------------------------------------------

/**
 * Dùng email làm salt thay vì một salt ngẫu nhiên lưu riêng.
 *
 * Email không phải salt lý tưởng (không ngẫu nhiên), nhưng nó cho phép đăng nhập
 * trên máy mới chỉ với email + master password: client dẫn xuất được auth key
 * *trước khi* gọi server, nên server không cần tiết lộ salt cho người chưa xác
 * thực. Đây là đánh đổi mà Bitwarden và 1Password đều chọn.
 *
 * Salt ngẫu nhiên trong `params` vẫn được trộn thêm để hai account cùng email ở
 * hai lần đăng ký khác nhau không ra cùng khoá.
 */
export async function deriveMasterKey(
  email: string,
  masterPassword: string,
  params: KdfParams,
): Promise<Bytes> {
  if (params.type !== "pbkdf2-sha256") {
    throw new Error(`KDF không hỗ trợ: ${params.type}`);
  }
  if (masterPassword.length === 0) throw new Error("Master password rỗng");

  const salt = concat(utf8Encode(normalizeEmail(email)), fromBase64(params.salt));

  const baseKey = await crypto.subtle.importKey(
    "raw",
    utf8Encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: params.iterations, hash: "SHA-256" },
    baseKey,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Tách master key thành hai khoá độc lập bằng HKDF.
 *
 * Đây là lớp bảo vệ quan trọng nhất của thiết kế: server nhận `auth` để xác thực
 * bạn, nhưng từ `auth` không tính ngược ra được `enc`. Nếu dùng chung một khoá
 * cho cả hai việc, bất cứ ai đọc được request đăng nhập đều giải mã được vault.
 */
async function hkdfExpand(masterKey: Bytes, info: "auth" | "enc"): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", masterKey, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode(info) },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveAuthKey(masterKey: Bytes): Promise<Bytes> {
  return hkdfExpand(masterKey, "auth");
}

export async function deriveWrappingKey(masterKey: Bytes): Promise<CryptoKey> {
  const raw = await hkdfExpand(masterKey, "enc");
  return importAesKey(raw);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function importAesKey(raw: Bytes): Promise<CryptoKey> {
  // `extractable: false` — khoá không đọc ra được từ JS sau khi import, nên một
  // lỗi XSS trong popup cũng không lấy được nguyên liệu khoá ra ngoài.
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ---------------------------------------------------------------------------
// Mã hoá đối xứng
// ---------------------------------------------------------------------------

export async function seal(key: CryptoKey, plaintext: Bytes): Promise<SealedData> {
  // Nonce mới cho mỗi lần mã hoá. Dùng lại nonce với cùng khoá trong AES-GCM làm
  // sập hoàn toàn tính bảo mật — không chỉ lộ plaintext mà còn lộ khoá xác thực.
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce) };
}

export async function open(key: CryptoKey, sealed: SealedData): Promise<Bytes> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.nonce) },
    key,
    fromBase64(sealed.ciphertext),
  );
  return new Uint8Array(plaintext);
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<SealedData> {
  return seal(key, utf8Encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, sealed: SealedData): Promise<T> {
  return JSON.parse(utf8Decode(await open(key, sealed))) as T;
}

// ---------------------------------------------------------------------------
// Vault key
// ---------------------------------------------------------------------------

/**
 * Vault key là khoá ngẫu nhiên thật sự, không dẫn xuất từ master password.
 *
 * Nhờ vậy đổi master password chỉ cần bọc lại vault key bằng wrapping key mới —
 * không phải mã hoá lại toàn bộ item. Thiếu lớp này thì đổi master password trên
 * vault 500 item là 500 lượt ghi và một cơ hội mất dữ liệu giữa đường.
 */
export function createVaultKey(): Bytes {
  return randomBytes(KEY_BYTES);
}

export async function importVaultKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) throw new Error("Vault key phải dài 32 byte");
  return importAesKey(raw);
}

/** Tạo bộ dữ liệu mật mã cho account mới. Trả cả vault key để dùng ngay. */
export async function createAccount(
  email: string,
  masterPassword: string,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<{ record: AccountCryptoRecord; vaultKey: CryptoKey }> {
  const kdf: KdfParams = {
    type: "pbkdf2-sha256",
    iterations,
    salt: toBase64(randomBytes(16)),
  };

  const masterKey = await deriveMasterKey(email, masterPassword, kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);

  const vaultKeyRaw = createVaultKey();
  const wrappedVaultKey = await seal(wrappingKey, vaultKeyRaw);

  return {
    record: { kdf, authKey: toBase64(authKey), wrappedVaultKey },
    vaultKey: await importVaultKey(vaultKeyRaw),
  };
}

/**
 * Mở vault từ master password + dữ liệu server trả về.
 *
 * Nếu master password sai, `open()` sẽ ném lỗi vì GCM tag không khớp — đây là
 * cách ta biết mật khẩu sai mà không cần server xác nhận gì, và cũng là lý do
 * AES-GCM (có xác thực) được chọn thay vì AES-CBC (không có).
 */
export async function unlockVault(
  email: string,
  masterPassword: string,
  record: Pick<AccountCryptoRecord, "kdf" | "wrappedVaultKey">,
): Promise<{ vaultKey: CryptoKey; vaultKeyRaw: Bytes; authKey: string }> {
  const masterKey = await deriveMasterKey(email, masterPassword, record.kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);

  let vaultKeyRaw: Bytes;
  try {
    vaultKeyRaw = await open(wrappingKey, record.wrappedVaultKey);
  } catch {
    throw new Error("Master password không đúng");
  }

  return {
    vaultKey: await importVaultKey(vaultKeyRaw),
    vaultKeyRaw,
    authKey: toBase64(authKey),
  };
}

/** Đổi master password: chỉ bọc lại vault key, không chạm vào item nào. */
export async function rewrapVaultKey(
  email: string,
  newMasterPassword: string,
  vaultKeyRaw: Bytes,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<AccountCryptoRecord> {
  const kdf: KdfParams = {
    type: "pbkdf2-sha256",
    iterations,
    salt: toBase64(randomBytes(16)),
  };
  const masterKey = await deriveMasterKey(email, newMasterPassword, kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);
  return {
    kdf,
    authKey: toBase64(authKey),
    wrappedVaultKey: await seal(wrappingKey, vaultKeyRaw),
  };
}

// ---------------------------------------------------------------------------
// Phía server
// ---------------------------------------------------------------------------

/**
 * Hash auth key để lưu trong D1.
 *
 * Một vòng SHA-256 là đủ ở đây, khác với hash mật khẩu thông thường: auth key đã
 * là 32 byte entropy đều, ra từ 600.000 vòng PBKDF2. Không có từ điển nào dò
 * được nó, nên làm hash chậm chỉ tốn CPU của Worker mà không thêm an toàn.
 */
export async function hashAuthKey(authKeyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(authKeyBase64));
  return toBase64(new Uint8Array(digest));
}
