import { describe, expect, it } from "vitest";
import {
  buildOtpauthUri,
  generateTotp,
  generateTotpSecret,
  parseOtpauthUri,
  parseTotpInput,
  secondsRemaining,
} from "../src/core/totp.js";
import { base32Encode, isValidBase32 } from "../src/core/base32.js";
import { utf8Encode } from "../src/core/bytes.js";

/**
 * Vector chuẩn RFC 6238 Appendix B. Seed là chuỗi ASCII "12345678901234567890"
 * lặp cho đủ độ dài khoá của từng thuật toán, và tất cả dùng digits = 8.
 */
const SEED_SHA1 = base32Encode(utf8Encode("12345678901234567890"));
const SEED_SHA256 = base32Encode(utf8Encode("12345678901234567890123456789012"));
const SEED_SHA512 = base32Encode(
  utf8Encode("1234567890123456789012345678901234567890123456789012345678901234"),
);

const RFC6238_VECTORS: Array<[number, string, string, string]> = [
  // [unix seconds, SHA-1, SHA-256, SHA-512]
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

describe("generateTotp — vector chuẩn RFC 6238", () => {
  it.each(RFC6238_VECTORS)("t=%i cho ra mã đúng ở cả ba thuật toán", async (t, s1, s256, s512) => {
    const at = t * 1000;
    await expect(
      generateTotp({ secret: SEED_SHA1, algorithm: "SHA-1", digits: 8 }, at),
    ).resolves.toBe(s1);
    await expect(
      generateTotp({ secret: SEED_SHA256, algorithm: "SHA-256", digits: 8 }, at),
    ).resolves.toBe(s256);
    await expect(
      generateTotp({ secret: SEED_SHA512, algorithm: "SHA-512", digits: 8 }, at),
    ).resolves.toBe(s512);
  });

  it("t=20000000000 vượt mốc 32-bit mà vẫn đúng", async () => {
    // counter = 20000000000/30 = 666_666_666, chưa vượt 2^31 nhưng vector này là
    // chỗ duy nhất trong RFC kiểm tra counter lớn. Giữ riêng một test để nếu ai
    // đổi BigInt về phép dịch bit thường thì nó hỏng ngay.
    await expect(
      generateTotp({ secret: SEED_SHA1, algorithm: "SHA-1", digits: 8 }, 20000000000 * 1000),
    ).resolves.toBe("65353130");
  });

  it("mặc định là 6 số, SHA-1, chu kỳ 30 giây", async () => {
    const code = await generateTotp({ secret: SEED_SHA1 }, 59 * 1000);
    expect(code).toHaveLength(6);
    // 6 số cuối của vector 8 số cùng thời điểm.
    expect(code).toBe("287082");
  });

  it("mã không đổi trong cùng một cửa sổ 30 giây", async () => {
    const a = await generateTotp({ secret: SEED_SHA1 }, 30_000);
    const b = await generateTotp({ secret: SEED_SHA1 }, 59_999);
    expect(a).toBe(b);
  });

  it("mã đổi khi sang cửa sổ kế tiếp", async () => {
    const a = await generateTotp({ secret: SEED_SHA1 }, 59_999);
    const b = await generateTotp({ secret: SEED_SHA1 }, 60_000);
    expect(a).not.toBe(b);
  });

  it("từ chối secret rỗng thay vì trả mã vô nghĩa", async () => {
    await expect(generateTotp({ secret: "" })).rejects.toThrow(/rỗng/);
  });
});

describe("secondsRemaining", () => {
  it("đếm ngược từ 30 về 1 trong một chu kỳ", () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 1_000)).toBe(29);
    expect(secondsRemaining(30, 29_000)).toBe(1);
    expect(secondsRemaining(30, 30_000)).toBe(30);
  });
});

describe("parseOtpauthUri", () => {
  it("đọc được URI Google Authenticator thông thường", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/GitHub:ban%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
    );
    expect(config).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "GitHub",
      account: "ban@example.com",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });
  });

  it("đọc được tham số không mặc định", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60",
    );
    expect(config).toMatchObject({ algorithm: "SHA-256", digits: 8, period: 60 });
  });

  it("ưu tiên tham số issuer hơn phần issuer trong label", () => {
    // Khi hai chỗ lệch nhau, Google khuyến nghị tin tham số issuer.
    const config = parseOtpauthUri(
      "otpauth://totp/Cu%C3%A3:a@b.com?secret=JBSWY3DPEHPK3PXP&issuer=M%E1%BB%9Bi",
    );
    expect(config.issuer).toBe("Mới");
    expect(config.account).toBe("a@b.com");
  });

  it("bỏ qua digits/period vô lý và dùng mặc định", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&digits=99&period=abc",
    );
    expect(config).toMatchObject({ digits: 6, period: 30 });
  });

  it("từ chối HOTP, URI sai scheme, thiếu secret, secret rác", () => {
    expect(() => parseOtpauthUri("otpauth://hotp/A?secret=JBSWY3DPEHPK3PXP&counter=1")).toThrow(
      /không hỗ trợ HOTP/,
    );
    expect(() => parseOtpauthUri("https://totp/A?secret=JBSWY3DPEHPK3PXP")).toThrow(/otpauth/);
    expect(() => parseOtpauthUri("otpauth://totp/A")).toThrow(/secret/);
    expect(() => parseOtpauthUri("otpauth://totp/A?secret=has!bad@chars")).toThrow(/secret/);
    expect(() => parseOtpauthUri("không phải uri")).toThrow(/không hợp lệ/);
  });

  it("round-trip với buildOtpauthUri", () => {
    const original = {
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA-256" as const,
      digits: 8,
      period: 60,
      issuer: "Acme Inc",
      account: "me@acme.com",
    };
    expect(parseOtpauthUri(buildOtpauthUri(original))).toMatchObject(original);
  });
});

describe("parseTotpInput", () => {
  it("nhận chuỗi base32 dán tay, kể cả có khoảng trắng", () => {
    expect(parseTotpInput("jbsw y3dp ehpk 3pxp", "me@x.com")).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      account: "me@x.com",
    });
  });

  it("nhận URI otpauth và chuyển cho parser đầy đủ", () => {
    expect(parseTotpInput("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP&digits=8").digits).toBe(8);
  });

  it("báo lỗi rõ ràng khi dán sai thứ", () => {
    expect(() => parseTotpInput("mật khẩu của tôi")).toThrow(/base32/);
  });
});

describe("generateTotpSecret", () => {
  it("sinh secret 20 byte hợp lệ, mỗi lần một khác", async () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(isValidBase32(a)).toBe(true);
    expect(a).not.toBe(b);
    // Secret mới phải dùng được ngay để sinh mã.
    await expect(generateTotp({ secret: a })).resolves.toMatch(/^\d{6}$/);
  });
});
