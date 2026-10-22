import { describe, expect, it } from "vitest";
import { savedLoginDomains, siteWarning } from "../extension/lib/site-warning.js";

type Item = Parameters<typeof siteWarning>[1][number];

const login = (url: string, extra: Partial<Item> = {}): Item => ({
  id: url,
  title: url,
  url,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const ITEMS: Item[] = [
  login("https://www.paypal.com/signin"),
  login("https://github.com", { urls: ["https://accounts.google.com"] }),
];

describe("savedLoginDomains", () => {
  it("collects registrable domains from every saved login URL", () => {
    expect(savedLoginDomains(ITEMS)).toEqual(["paypal.com", "github.com", "google.com"]);
  });

  it("ignores trashed items, non-login items and unparsable URLs", () => {
    expect(
      savedLoginDomains([
        login("https://bank.example", { trashedAt: 1 }),
        login("https://card.example", { type: "card" }),
        { id: "n", title: "note", note: "https://note.example", createdAt: 0, updatedAt: 0 },
        login("not a url"),
      ]),
    ).toEqual([]);
  });
});

describe("siteWarning", () => {
  it("warns on a lookalike of a saved login", () => {
    expect(siteWarning("https://paypa1.com/login", ITEMS)).toMatchObject({
      kind: "lookalike",
      target: "paypal.com",
    });
    expect(siteWarning("http://github.com.login-secure.io/", ITEMS)).toMatchObject({
      target: "github.com",
      reason: "embedded",
    });
    const cyrillic = new URL("https://gіthub.com").href;
    expect(siteWarning(cyrillic, ITEMS)).toMatchObject({ target: "github.com" });
  });

  it("stays quiet on the saved site and its subdomains", () => {
    for (const url of [
      "https://paypal.com",
      "https://www.paypal.com/x",
      "https://gist.github.com",
      "https://mail.google.com",
    ]) {
      expect(siteWarning(url, ITEMS), url).toBeNull();
    }
  });

  it("does not warn about a lookalike of a trashed login", () => {
    const trashed = [login("https://paypal.com", { trashedAt: 1 })];
    expect(siteWarning("https://paypa1.com", trashed)).toBeNull();
  });

  it("only checks web pages", () => {
    for (const url of [
      undefined,
      "",
      "not a url",
      "chrome://settings",
      "file:///home/paypa1.com",
      "javascript:alert(1)",
      "data:text/html,paypa1.com",
      "ftp://paypa1.com",
    ]) {
      expect(siteWarning(url, ITEMS), String(url)).toBeNull();
    }
  });

  it("does not throw with an empty vault", () => {
    expect(siteWarning("https://paypa1.com", [])).toBeNull();
  });
});
