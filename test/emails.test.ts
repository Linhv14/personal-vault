import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  existingAccountEmail,
  orgInviteEmail,
  ownershipEmail,
  verificationCodeEmail,
} from "../src/worker/emails.js";

const context = {
  locale: "en" as const,
  siteUrl: "https://7key.online",
  recipient: "me@example.com",
};

describe("verificationCodeEmail", () => {
  const email = verificationCodeEmail(context, "042917");

  it("puts the code in the subject, the inbox preview, the body and the text part", () => {
    expect(email.subject).toContain("042917");
    expect(email.html).toMatch(/display:none[^>]*>Your code is 042917/);
    expect(email.html).toContain(">042917</p>");
    expect(email.text).toContain("042917");
  });

  it("links the privacy policy on the site that sent it, and loads nothing remote", () => {
    expect(email.html).toContain('href="https://7key.online/privacy"');
    expect(email.text).toContain("https://7key.online/privacy");
    expect(email.html).not.toMatch(/url\(/);
    const sources = [...email.html.matchAll(/src="([^"]*)"/g)].map((match) => match[1]);
    expect(sources).toEqual(["cid:7key-logo"]);
    expect(email.inlineImages.map((image) => image.contentId)).toEqual(["7key-logo"]);
  });

  it("embeds the extension icon as the logo, so the two never drift apart", () => {
    const icon = readFileSync(new URL("../extension/icons/icon-128.png", import.meta.url));
    expect(email.inlineImages[0]!.base64).toBe(icon.toString("base64"));
  });

  it("speaks the requested language", () => {
    const vietnamese = verificationCodeEmail({ ...context, locale: "vi" }, "042917");
    expect(vietnamese.subject).toBe("042917 là mã xác minh 7key của bạn");
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
    link: "https://7key.online/app/#/invite/0b9c6f1e-1111-4222-8333-444455556666",
  };
  const email = orgInviteEmail(context, invite);

  it("says who invited whom to which organization, with the role in the sentence", () => {
    expect(email.subject).toBe("owner@acme.test invited you to join Acme <Inc> on 7key");
    expect(email.html).toContain("Acme &#60;Inc&#62;");
    expect(email.html).not.toContain("Acme <Inc>");
    expect(email.text).toContain("as an admin");
  });

  it("links the invitation from a button and as a plain fallback link", () => {
    expect(email.html.split(`href="${invite.link}"`).length - 1).toBe(2);
    expect(email.text).toContain(invite.link);
  });

  it("names the invited address and the expiry date", () => {
    expect(email.text).toContain(
      "This invitation is for me@example.com and expires on 30 October 2026.",
    );
  });

  it("speaks the requested language", () => {
    const vietnamese = orgInviteEmail({ ...context, locale: "vi" }, { ...invite, role: "member" });
    expect(vietnamese.html).toContain('lang="vi"');
    expect(vietnamese.text).toContain("với vai trò thành viên");
  });
});

describe("email footer", () => {
  it("is one line: the product, the site and the privacy policy", () => {
    const email = verificationCodeEmail(context, "042917");
    expect(email.html).toContain('href="https://7key.online"');
    expect(email.text).toContain("7key · 7key.online");
  });
});

describe("ownershipEmail", () => {
  const email = ownershipEmail(context, {
    org: "Acme",
    previous: "old@acme.test",
    link: "https://7key.online/app/#/org-1/settings",
  });

  it("says who handed over which organization and links its settings", () => {
    expect(email.subject).toBe("You're now the owner of Acme on 7key");
    expect(email.text).toContain("old@acme.test transferred ownership of Acme to you.");
    expect(email.html).toContain('href="https://7key.online/app/#/org-1/settings"');
  });
});
