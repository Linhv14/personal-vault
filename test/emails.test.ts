import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  existingAccountEmail,
  orgInviteEmail,
  verificationCodeEmail,
} from "../src/worker/emails.js";

const context = {
  locale: "en" as const,
  siteUrl: "https://1pw.online",
  recipient: "me@example.com",
};

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
    expect(sources).toEqual(["cid:trust1-vault-logo"]);
    expect(email.inlineImages.map((image) => image.contentId)).toEqual(["trust1-vault-logo"]);
  });

  it("embeds the extension icon as the logo, so the two never drift apart", () => {
    const icon = readFileSync(new URL("../extension/icons/icon-128.png", import.meta.url));
    expect(email.inlineImages[0]!.base64).toBe(icon.toString("base64"));
  });

  it("speaks the requested language", () => {
    const vietnamese = verificationCodeEmail({ ...context, locale: "vi" }, "042917");
    expect(vietnamese.subject).toBe("042917 là mã xác minh Trust1 Vault của bạn");
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

describe("orgInviteEmail", () => {
  const invite = {
    org: "Acme <Inc>",
    inviter: "owner@acme.test",
    email: "me@example.com",
    role: "admin" as const,
    expiresAt: Date.UTC(2026, 9, 30, 12) / 1000,
    link: "https://1pw.online/app/#/invite/0b9c6f1e-1111-4222-8333-444455556666",
  };
  const email = orgInviteEmail(context, invite);

  it("names the organization and who sent it", () => {
    expect(email.subject).toContain("Acme <Inc>");
    expect(email.html).toContain("Acme &#60;Inc&#62;");
    expect(email.html).not.toContain("Acme <Inc>");
    expect(email.html).toContain("owner@acme.test");
  });

  it("links the invitation from a button and from the text part", () => {
    expect(email.html).toContain(`href="${invite.link}"`);
    expect(email.text).toContain(invite.link);
  });

  it("lists the role and the expiry date, and tells newcomers which email to sign up with", () => {
    expect(email.html).toContain("Admin");
    expect(email.html).toContain("2026");
    expect(email.text).toContain("me@example.com");
  });

  it("speaks the requested language", () => {
    const vietnamese = orgInviteEmail({ ...context, locale: "vi" }, invite);
    expect(vietnamese.html).toContain('lang="vi"');
    expect(vietnamese.subject).not.toBe(email.subject);
  });
});

describe("email footer", () => {
  it("is one line: copyright, the site and the privacy policy", () => {
    const email = verificationCodeEmail(context, "042917");
    expect(email.html).toContain(`© ${new Date().getUTCFullYear()} Trust1 Vault`);
    expect(email.html).toContain('href="https://1pw.online"');
    expect(email.text).toContain("© ");
  });
});
