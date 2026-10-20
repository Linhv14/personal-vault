import { describe, expect, it } from "vitest";
import {
  damerauLevenshtein,
  decodePunycode,
  findLookalike,
  skeleton,
  unicodeHost,
} from "../src/core/lookalike.js";

const SAVED = [
  "github.com",
  "paypal.com",
  "google.com",
  "vietcombank.com.vn",
  "1password.com",
  "microsoft.com",
  "apple.com",
  "x.com",
  "ebay.com",
  "mail.com",
  "shop.com",
];

function target(host: string, saved = SAVED) {
  return findLookalike(host, saved)?.target ?? null;
}

function reason(host: string, saved = SAVED) {
  return findLookalike(host, saved)?.reason ?? null;
}

describe("punycode and skeletons", () => {
  it("decodes IDN labels", () => {
    expect(decodePunycode("80ak6aa92e")).toBe("аррӏе");
    expect(decodePunycode("mnchen-3ya")).toBe("münchen");
    expect(unicodeHost("xn--80ak6aa92e.com")).toBe("аррӏе.com");
    expect(unicodeHost("www.example.com")).toBe("www.example.com");
  });

  it("returns null for broken punycode", () => {
    expect(decodePunycode("a-")).toBe("a");
    expect(decodePunycode("99999999999999")).toBeNull();
  });

  it("maps confusable characters to plain ASCII", () => {
    expect(skeleton("аррӏе")).toBe("apple");
    expect(skeleton("gіthub")).toBe("github");
    expect(skeleton("paypa1")).toBe("paypal");
    expect(skeleton("g00gle")).toBe("google");
    expect(skeleton("rnicrosoft")).toBe("microsoft");
    expect(skeleton("ｇｉｔｈｕｂ")).toBe("github");
    expect(skeleton("gíthüb")).toBe("github");
  });

  it("measures transpositions as a single edit", () => {
    expect(damerauLevenshtein("github", "githbu")).toBe(1);
    expect(damerauLevenshtein("github", "gitlab")).toBe(2);
    expect(damerauLevenshtein("paypal", "paypall")).toBe(1);
    expect(damerauLevenshtein("", "abc")).toBe(3);
  });
});

describe("findLookalike", () => {
  it("never warns on the saved site itself or its subdomains", () => {
    for (const host of [
      "github.com",
      "www.github.com",
      "gist.github.com",
      "api.github.com",
      "accounts.google.com",
      "ibanking.vietcombank.com.vn",
    ]) {
      expect(findLookalike(host, SAVED), host).toBeNull();
    }
  });

  it("returns the match shape", () => {
    expect(findLookalike("xn--80ak6aa92e.com", SAVED)).toEqual({
      kind: "lookalike",
      target: "apple.com",
      reason: "confusable",
    });
  });

  it("flags IDN homographs of a saved domain", () => {
    expect(target("xn--80ak6aa92e.com")).toBe("apple.com");
    const cyrillicI = new URL("https://gіthub.com").hostname;
    expect(cyrillicI.startsWith("xn--")).toBe(true);
    expect(target(cyrillicI)).toBe("github.com");
    expect(reason(cyrillicI)).toBe("confusable");
  });

  it("flags ASCII confusables such as digits and rn for m", () => {
    expect(target("paypa1.com")).toBe("paypal.com");
    expect(target("g00gle.com")).toBe("google.com");
    expect(target("rnicrosoft.com")).toBe("microsoft.com");
    expect(target("lpassword.com")).toBe("1password.com");
    expect(reason("rnicrosoft.com")).toBe("confusable");
  });

  it("flags a saved brand used as a subdomain or hyphenated part of another domain", () => {
    expect(target("github.com.login-secure.io")).toBe("github.com");
    expect(target("paypal-verify.com")).toBe("paypal.com");
    expect(target("secure-paypal.co.uk")).toBe("paypal.com");
    expect(target("paypal.account-update.net")).toBe("paypal.com");
    expect(target("paypa1-verify.com")).toBe("paypal.com");
    expect(reason("github.com.login-secure.io")).toBe("embedded");
  });

  it("does not treat a longer word containing the brand as the brand", () => {
    expect(target("githubusercontent.com")).toBeNull();
    expect(target("login.microsoftonline.com")).toBeNull();
    expect(target("applebees.com")).toBeNull();
  });

  it("ignores short and generic saved labels", () => {
    expect(target("x.co")).toBeNull();
    expect(target("y.com")).toBeNull();
    expect(target("mail.evil.io")).toBeNull();
    expect(target("gmail.com")).toBeNull();
    expect(target("shop.example.com")).toBeNull();
    expect(target("myshop.com")).toBeNull();
    expect(target("shops.com")).toBeNull();
  });

  it("flags one-character typos on the same or a swappable TLD", () => {
    expect(target("githbu.com")).toBe("github.com");
    expect(target("gihub.com")).toBe("github.com");
    expect(target("github.co")).toBe("github.com");
    expect(target("paypall.com")).toBe("paypal.com");
    expect(target("ebey.com")).toBe("ebay.com");
    expect(reason("githbu.com")).toBe("typo");
  });

  it("allows two edits only for labels of ten characters or more", () => {
    expect(target("vietconbamk.com.vn")).toBe("vietcombank.com.vn");
    expect(target("mircosfot.com")).toBeNull();
  });

  it("does not flag gitlab.com as github.com", () => {
    expect(target("gitlab.com")).toBeNull();
  });

  it("flags the same name on a swappable TLD, including github.io", () => {
    expect(target("github.io")).toBe("github.com");
    expect(target("paypal.co")).toBe("paypal.com");
    expect(target("paypal.net")).toBe("paypal.com");
  });

  it("leaves user sites on shared hosting alone unless they borrow the brand", () => {
    expect(target("alice.github.io")).toBeNull();
    expect(target("github-login.github.io")).toBe("github.com");
  });

  it("does not flag regional versions of a saved site", () => {
    expect(target("google.com.vn")).toBeNull();
    expect(target("google.de")).toBeNull();
    expect(target("apple.co.uk")).toBeNull();
    expect(target("vietcombank.com")).toBeNull();
  });

  it("does not flag unrelated domains or typos on unrelated TLDs", () => {
    expect(target("example.com")).toBeNull();
    expect(target("githbu.de")).toBeNull();
    expect(target("pinterest.com")).toBeNull();
    expect(target("ebay.de")).toBeNull();
  });

  it("does not warn when the lookalike is itself saved", () => {
    expect(findLookalike("paypa1.com", [...SAVED, "paypa1.com"])).toBeNull();
  });

  it("ignores IPs, localhost and malformed input", () => {
    expect(findLookalike("127.0.0.1", SAVED)).toBeNull();
    expect(findLookalike("localhost", SAVED)).toBeNull();
    expect(findLookalike("", SAVED)).toBeNull();
    expect(findLookalike("githbu.com", ["", "localhost", "10.0.0.1"])).toBeNull();
  });

  it("accepts saved entries as URLs or hosts", () => {
    expect(findLookalike("githbu.com", ["https://github.com/login"])?.target).toBe("github.com");
    expect(findLookalike("githbu.com", ["www.github.com"])?.target).toBe("github.com");
  });

  it("returns nothing when there are no saved logins", () => {
    expect(findLookalike("paypa1.com", [])).toBeNull();
  });
});
