import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existingAccountEmail, verificationCodeEmail } from "../src/worker/emails.js";

const context = { locale: "en" as const, siteUrl: "https://1pw.online" };

describe("verificationCodeEmail", () => {
  const email = verificationCodeEmail(context, "042917");

  it("puts the code in the subject, the inbox preview, the body and the text part", () => {
    expect(email.subject).toContain("042917");
    expect(email.html).toMatch(/display:none[^>]*>Your code is 042917/);
    expect(email.html).toContain(">042917</div>");
    expect(email.text).toContain("042917");
  });

  it("links the privacy policy on the site that sent it, and loads nothing remote", () => {
    expect(email.html).toContain('href="https://1pw.online/privacy"');
    expect(email.text).toContain("https://1pw.online/privacy");
    expect(email.html).not.toMatch(/url\(/);
    const sources = [...email.html.matchAll(/src="([^"]*)"/g)].map((match) => match[1]);
    expect(sources).toEqual(["cid:1pw-logo"]);
    expect(email.inlineImages.map((image) => image.contentId)).toEqual(["1pw-logo"]);
  });

  it("embeds the extension icon as the logo, so the two never drift apart", () => {
    const icon = readFileSync(new URL("../extension/icons/icon-128.png", import.meta.url));
    expect(email.inlineImages[0]!.base64).toBe(icon.toString("base64"));
  });

  it("speaks the requested language", () => {
    const vietnamese = verificationCodeEmail({ ...context, locale: "vi" }, "042917");
    expect(vietnamese.subject).toBe("042917 là mã xác minh 1PW của bạn");
    expect(vietnamese.html).toContain('lang="vi"');
  });
});

describe("existingAccountEmail", () => {
  it("carries no code and tells the owner how to sign in", () => {
    const email = existingAccountEmail(context);
    expect(email.html).not.toMatch(/\b\d{6}\b/);
    expect(email.text).toContain('"Sign in to your vault"');
  });

  it("escapes what it interpolates", () => {
    const email = existingAccountEmail({ ...context, siteUrl: 'https://x.test/"><script>' });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&#34;&#62;&#60;script&#62;");
  });
});
