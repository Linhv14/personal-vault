import { describe, expect, it, vi } from "vitest";
import {
  checkMasterPassword,
  MASTER_PASSWORD_MAX_LENGTH,
  MASTER_PASSWORD_MIN_LENGTH,
  masterPasswordIssue,
} from "../src/core/master-password.js";
import {
  assertMasterPasswordPolicy,
  checkNewMasterPassword,
  MasterPasswordRejected,
} from "../extension/lib/master-password.js";
import { createTranslator, describeError } from "../src/i18n/index.js";

const EMAIL = "alice.wonder@example.com";

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

describe("masterPasswordIssue", () => {
  it("requires at least 12 characters and allows at least 64", () => {
    expect(MASTER_PASSWORD_MIN_LENGTH).toBe(12);
    expect(MASTER_PASSWORD_MAX_LENGTH).toBeGreaterThanOrEqual(64);
    expect(masterPasswordIssue("a".repeat(11), EMAIL)).toEqual({ code: "too_short", min: 12 });
    expect(masterPasswordIssue("a".repeat(12), EMAIL)).toBeNull();
    expect(masterPasswordIssue("x".repeat(64), EMAIL)).toBeNull();
    expect(masterPasswordIssue("x".repeat(MASTER_PASSWORD_MAX_LENGTH + 1), EMAIL)).toEqual({
      code: "too_long",
      max: MASTER_PASSWORD_MAX_LENGTH,
    });
  });

  it("counts characters rather than UTF-16 code units", () => {
    expect(masterPasswordIssue("🔑".repeat(11), EMAIL)?.code).toBe("too_short");
    expect(masterPasswordIssue("mật khẩu chính", EMAIL)).toBeNull();
  });

  it("imposes no composition rules", () => {
    expect(masterPasswordIssue("all lowercase words", EMAIL)).toBeNull();
    expect(masterPasswordIssue("            ", EMAIL)).toBeNull();
  });

  it("rejects the email address or its local part, ignoring case", () => {
    expect(masterPasswordIssue("Alice.Wonder@Example.com", EMAIL)).toEqual({
      code: "matches_email",
    });
    expect(masterPasswordIssue("ALICE.WONDER", EMAIL)).toEqual({ code: "matches_email" });
    expect(masterPasswordIssue("alice.wonder!", EMAIL)).toBeNull();
  });
});

describe("checkMasterPassword", () => {
  it("blocks a breached password with its exposure count", async () => {
    const lookup = vi.fn(async () => 3861493);
    expect(await checkMasterPassword("password1234", EMAIL, lookup)).toEqual({
      code: "breached",
      count: 3861493,
    });
  });

  it("allows the password when the breach lookup fails", async () => {
    const lookup = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await checkMasterPassword("offline but long", EMAIL, lookup)).toBeNull();
  });

  it("skips the breach lookup when the local policy already fails", async () => {
    const lookup = vi.fn(async () => 0);
    expect(await checkMasterPassword("short", EMAIL, lookup)).toEqual({
      code: "too_short",
      min: 12,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("checkNewMasterPassword", () => {
  it("sends only the five-character hash prefix and matches the suffix", async () => {
    const password = "correct horse battery";
    const hash = await sha1Hex(password);
    const fetchRange = vi.fn(async (prefix: string) =>
      [`${"0".repeat(35)}:0`, `${hash.slice(5)}:42`, `${"F".repeat(35)}:7`].join("\r\n"),
    );
    expect(await checkNewMasterPassword(password, EMAIL, fetchRange)).toEqual({
      code: "breached",
      count: 42,
    });
    expect(fetchRange).toHaveBeenCalledWith(hash.slice(0, 5));
  });

  it("ignores padding entries with a zero count", async () => {
    const password = "padded response";
    const hash = await sha1Hex(password);
    const fetchRange = vi.fn(async () => `${hash.slice(5)}:0`);
    expect(await checkNewMasterPassword(password, EMAIL, fetchRange)).toBeNull();
  });

  it("allows the password when the breach service is unreachable", async () => {
    const fetchRange = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await checkNewMasterPassword("an offline password", EMAIL, fetchRange)).toBeNull();
  });
});

describe("MasterPasswordRejected", () => {
  it("describes itself in the user's language", () => {
    const en = createTranslator("en");
    const vi = createTranslator("vi");
    const breached = new MasterPasswordRejected({ code: "breached", count: 5 });
    expect(describeError(breached, en)).toBe("This password has been exposed in breaches 5 times");
    expect(describeError(breached, vi)).toBe("Mật khẩu này đã bị lộ 5 lần");
  });

  it("guards account flows that bypass the form", () => {
    expect(() => assertMasterPasswordPolicy("short", EMAIL)).toThrow(MasterPasswordRejected);
    expect(() => assertMasterPasswordPolicy("long enough phrase", EMAIL)).not.toThrow();
  });
});
