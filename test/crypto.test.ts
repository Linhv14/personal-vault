import { describe, expect, it } from "vitest";
import {
  DEFAULT_KDF_ITERATIONS,
  createAccount,
  createVaultKey,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  hashAuthKey,
  importVaultKey,
  open,
  openJson,
  rewrapVaultKey,
  seal,
  sealJson,
  unlockVault,
  type KdfParams,
} from "../src/core/crypto.js";
import { fromBase64, toBase64, utf8Decode, utf8Encode } from "../src/core/bytes.js";

// Test dùng ít vòng PBKDF2 để chạy nhanh. Mức thật là DEFAULT_KDF_ITERATIONS.
const FAST = 1_000;
const EMAIL = "ban@example.com";
const PASSWORD = "mật khẩu chủ rất dài và khó đoán 2026";

const KDF: KdfParams = { type: "pbkdf2-sha256", iterations: FAST, salt: toBase64(new Uint8Array(16)) };

describe("deriveMasterKey", () => {
  it("cho ra 32 byte và lặp lại được với cùng input", async () => {
    const a = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    const b = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
  });

  it("chuẩn hoá email: hoa/thường và khoảng trắng không làm đổi khoá", async () => {
    // Nếu không chuẩn hoá, người dùng gõ "Ban@Example.com " sẽ không mở nổi
    // vault của chính mình — một lỗi rất khó tự chẩn đoán.
    const a = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    const b = await deriveMasterKey("  BAN@Example.COM  ", PASSWORD, KDF);
    expect(a).toEqual(b);
  });

  it("đổi email, mật khẩu, salt hay số vòng đều cho khoá khác", async () => {
    const base = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveMasterKey("khac@x.com", PASSWORD, KDF)).not.toEqual(base);
    expect(await deriveMasterKey(EMAIL, PASSWORD + "x", KDF)).not.toEqual(base);
    expect(
      await deriveMasterKey(EMAIL, PASSWORD, { ...KDF, salt: toBase64(new Uint8Array([1])) }),
    ).not.toEqual(base);
    expect(await deriveMasterKey(EMAIL, PASSWORD, { ...KDF, iterations: FAST + 1 })).not.toEqual(
      base,
    );
  });

  it("từ chối mật khẩu rỗng và KDF lạ", async () => {
    await expect(deriveMasterKey(EMAIL, "", KDF)).rejects.toThrow(/rỗng/);
    await expect(
      deriveMasterKey(EMAIL, PASSWORD, { ...KDF, type: "argon2id" as never }),
    ).rejects.toThrow(/không hỗ trợ/);
  });

  it("mặc định dùng 600.000 vòng", () => {
    expect(DEFAULT_KDF_ITERATIONS).toBe(600_000);
  });
});

describe("tách auth key và encryption key", () => {
  it("auth key không trùng với master key", async () => {
    // Nếu auth key chính là master key thì gửi nó lên server là gửi luôn khoá
    // giải mã vault.
    const masterKey = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveAuthKey(masterKey)).not.toEqual(masterKey);
  });

  it("auth key là xác định, không ngẫu nhiên", async () => {
    const masterKey = await deriveMasterKey(EMAIL, PASSWORD, KDF);
    expect(await deriveAuthKey(masterKey)).toEqual(await deriveAuthKey(masterKey));
  });

  it("wrapping key không mở được dữ liệu niêm bằng khoá dẫn từ master key khác", async () => {
    const k1 = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD, KDF));
    const k2 = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD + "x", KDF));
    const sealed = await seal(k1, utf8Encode("bí mật"));
    await expect(open(k2, sealed)).rejects.toThrow();
  });

  it("wrapping key không xuất ra được từ JS", async () => {
    const key = await deriveWrappingKey(await deriveMasterKey(EMAIL, PASSWORD, KDF));
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

describe("seal / open", () => {
  it("round-trip giữ nguyên nội dung, kể cả tiếng Việt có dấu", async () => {
    const key = await importVaultKey(createVaultKey());
    const plaintext = "Mật khẩu: Trời ơi #2026 — ốc, ưởng, ễ";
    const sealed = await seal(key, utf8Encode(plaintext));
    expect(utf8Decode(await open(key, sealed))).toBe(plaintext);
  });

  it("nonce khác nhau mỗi lần, nên cùng plaintext ra ciphertext khác", async () => {
    // Dùng lại nonce với AES-GCM làm sập hoàn toàn tính bảo mật, nên đây là một
    // trong những bất biến quan trọng nhất của cả lớp này.
    const key = await importVaultKey(createVaultKey());
    const a = await seal(key, utf8Encode("x"));
    const b = await seal(key, utf8Encode("x"));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("nonce dài 12 byte đúng khuyến nghị của AES-GCM", async () => {
    const key = await importVaultKey(createVaultKey());
    expect(fromBase64((await seal(key, utf8Encode("x"))).nonce)).toHaveLength(12);
  });

  it("phát hiện ciphertext bị sửa một bit", async () => {
    // Đây là điểm AES-GCM hơn AES-CBC: sửa ciphertext thì giải mã thất bại thay
    // vì trả ra plaintext rác mà app tưởng là thật.
    const key = await importVaultKey(createVaultKey());
    const sealed = await seal(key, utf8Encode("số dư: 100"));
    const bytes = fromBase64(sealed.ciphertext);
    bytes[0]! ^= 0x01;
    await expect(open(key, { ...sealed, ciphertext: toBase64(bytes) })).rejects.toThrow();
  });

  it("phát hiện nonce bị đổi", async () => {
    const key = await importVaultKey(createVaultKey());
    const sealed = await seal(key, utf8Encode("x"));
    const nonce = fromBase64(sealed.nonce);
    nonce[0]! ^= 0x01;
    await expect(open(key, { ...sealed, nonce: toBase64(nonce) })).rejects.toThrow();
  });

  it("sealJson/openJson round-trip object lồng nhau", async () => {
    const key = await importVaultKey(createVaultKey());
    const item = {
      title: "Ngân hàng",
      username: "me@x.com",
      password: "p@ss",
      totp: { secret: "JBSWY3DPEHPK3PXP", digits: 6 },
      tags: ["tài chính", "quan trọng"],
    };
    const sealed = await sealJson(key, item);
    expect(await openJson(key, sealed)).toEqual(item);
  });

  it("importVaultKey từ chối khoá sai độ dài", async () => {
    await expect(importVaultKey(new Uint8Array(16))).rejects.toThrow(/32 byte/);
  });
});

describe("createAccount / unlockVault", () => {
  it("mở lại được vault bằng đúng master password", async () => {
    const { record, vaultKey } = await createAccount(EMAIL, PASSWORD, FAST);
    const sealed = await sealJson(vaultKey, { secret: "xin chào" });

    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    expect(await openJson(unlocked.vaultKey, sealed)).toEqual({ secret: "xin chào" });
  });

  it("báo lỗi rõ ràng khi master password sai", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, FAST);
    await expect(unlockVault(EMAIL, "sai rồi", record)).rejects.toThrow(/không đúng/);
  });

  it("auth key trả về khi unlock khớp với auth key lúc đăng ký", async () => {
    // Đây là cách client đăng nhập lại trên máy mới mà không lưu gì.
    const { record } = await createAccount(EMAIL, PASSWORD, FAST);
    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    expect(unlocked.authKey).toBe(record.authKey);
  });

  it("mỗi account có salt riêng, nên cùng mật khẩu vẫn ra auth key khác", async () => {
    const a = await createAccount(EMAIL, PASSWORD, FAST);
    const b = await createAccount(EMAIL, PASSWORD, FAST);
    expect(a.record.kdf.salt).not.toBe(b.record.kdf.salt);
    expect(a.record.authKey).not.toBe(b.record.authKey);
  });
});

describe("rewrapVaultKey — đổi master password", () => {
  it("item mã hoá trước khi đổi vẫn giải mã được sau khi đổi", async () => {
    // Bất biến quan trọng nhất của lớp vault key: đổi master password KHÔNG cần
    // mã hoá lại item nào.
    const { record, vaultKey } = await createAccount(EMAIL, PASSWORD, FAST);
    const sealed = await sealJson(vaultKey, { note: "ghi chú cũ" });

    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    const newRecord = await rewrapVaultKey(EMAIL, "mật khẩu mới dài hơn", unlocked.vaultKeyRaw, FAST);

    const reopened = await unlockVault(EMAIL, "mật khẩu mới dài hơn", newRecord);
    expect(await openJson(reopened.vaultKey, sealed)).toEqual({ note: "ghi chú cũ" });
    expect(reopened.vaultKeyRaw).toEqual(unlocked.vaultKeyRaw);
  });

  it("mật khẩu cũ không còn mở được record mới", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, FAST);
    const unlocked = await unlockVault(EMAIL, PASSWORD, record);
    const newRecord = await rewrapVaultKey(EMAIL, "mật khẩu mới", unlocked.vaultKeyRaw, FAST);
    await expect(unlockVault(EMAIL, PASSWORD, newRecord)).rejects.toThrow(/không đúng/);
  });
});

describe("hashAuthKey", () => {
  it("xác định, dài 32 byte, và khác chính auth key", async () => {
    const { record } = await createAccount(EMAIL, PASSWORD, FAST);
    const hash = await hashAuthKey(record.authKey);
    expect(await hashAuthKey(record.authKey)).toBe(hash);
    expect(fromBase64(hash)).toHaveLength(32);
    expect(hash).not.toBe(record.authKey);
  });
});
