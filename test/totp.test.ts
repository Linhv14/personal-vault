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
import { expectCode, expectCodeAsync } from "./helpers.js";

const SEED_SHA1 = base32Encode(utf8Encode("12345678901234567890"));
const SEED_SHA256 = base32Encode(utf8Encode("12345678901234567890123456789012"));
const SEED_SHA512 = base32Encode(
  utf8Encode("1234567890123456789012345678901234567890123456789012345678901234"),
);

const RFC6238_VECTORS: Array<[unixSeconds: number, sha1: string, sha256: string, sha512: string]> =
  [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];

describe("generateTotp against the RFC 6238 vectors", () => {
  it.each(RFC6238_VECTORS)("t=%i matches on all three algorithms", async (t, s1, s256, s512) => {
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

  it("handles a counter beyond 32 bits, reached in the year 6053", async () => {
    await expect(
      generateTotp({ secret: SEED_SHA1, algorithm: "SHA-1", digits: 8 }, 20000000000 * 1000),
    ).resolves.toBe("65353130");
  });

  it("defaults to 6 digits, SHA-1 and a 30 second period", async () => {
    const code = await generateTotp({ secret: SEED_SHA1 }, 59 * 1000);
    expect(code).toHaveLength(6);
    expect(code).toBe("287082");
  });

  it("returns the same code throughout one window", async () => {
    const a = await generateTotp({ secret: SEED_SHA1 }, 30_000);
    const b = await generateTotp({ secret: SEED_SHA1 }, 59_999);
    expect(a).toBe(b);
  });

  it("changes code at the window boundary", async () => {
    const a = await generateTotp({ secret: SEED_SHA1 }, 59_999);
    const b = await generateTotp({ secret: SEED_SHA1 }, 60_000);
    expect(a).not.toBe(b);
  });

  it("rejects an empty secret instead of returning a meaningless code", async () => {
    await expectCodeAsync(generateTotp({ secret: "" }), "totp.empty_secret");
  });
});

describe("secondsRemaining", () => {
  it("counts down from 30 to 1 across a period", () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 1_000)).toBe(29);
    expect(secondsRemaining(30, 29_000)).toBe(1);
    expect(secondsRemaining(30, 30_000)).toBe(30);
  });
});

describe("parseOtpauthUri", () => {
  it("reads a standard Google Authenticator URI", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/GitHub:you%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
    );
    expect(config).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "GitHub",
      account: "you@example.com",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });
  });

  it("reads non-default parameters", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60",
    );
    expect(config).toMatchObject({ algorithm: "SHA-256", digits: 8, period: 60 });
  });

  it("prefers the issuer parameter over the label prefix", () => {
    const config = parseOtpauthUri("otpauth://totp/Old:a@b.com?secret=JBSWY3DPEHPK3PXP&issuer=New");
    expect(config.issuer).toBe("New");
    expect(config.account).toBe("a@b.com");
  });

  it("ignores nonsensical digits and period values", () => {
    const config = parseOtpauthUri(
      "otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&digits=99&period=abc",
    );
    expect(config).toMatchObject({ digits: 6, period: 30 });
  });

  it("rejects HOTP, wrong schemes, missing and malformed secrets", () => {
    expectCode(
      () => parseOtpauthUri("otpauth://hotp/A?secret=JBSWY3DPEHPK3PXP&counter=1"),
      "totp.not_totp",
    );
    expectCode(() => parseOtpauthUri("https://totp/A?secret=JBSWY3DPEHPK3PXP"), "totp.invalid_uri");
    expectCode(() => parseOtpauthUri("otpauth://totp/A"), "totp.missing_secret");
    expectCode(
      () => parseOtpauthUri("otpauth://totp/A?secret=has!bad@chars"),
      "totp.missing_secret",
    );
    expectCode(() => parseOtpauthUri("not a uri"), "totp.invalid_uri");
    expectCode(
      () => parseOtpauthUri("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP&algorithm=MD5"),
      "totp.unsupported_algorithm",
    );
  });

  it("round-trips through buildOtpauthUri", () => {
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
  it("accepts a pasted base32 secret, spaces included", () => {
    expect(parseTotpInput("jbsw y3dp ehpk 3pxp", "me@x.com")).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      account: "me@x.com",
    });
  });

  it("delegates otpauth URIs to the full parser", () => {
    expect(parseTotpInput("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP&digits=8").digits).toBe(8);
  });

  it("reports unrecognized input clearly", () => {
    expectCode(() => parseTotpInput("p@ssw0rd!"), "totp.unrecognized_input");
  });
});

describe("generateTotpSecret", () => {
  it("produces a distinct, valid 20-byte secret each time", async () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(isValidBase32(a)).toBe(true);
    expect(a).not.toBe(b);
    await expect(generateTotp({ secret: a })).resolves.toMatch(/^\d{6}$/);
  });
});
