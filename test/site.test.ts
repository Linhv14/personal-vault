import { describe, expect, it } from "vitest";
import { parseSiteUrl, registrableDomain, siteHostname, siteOf } from "../src/core/site.js";

describe("parseSiteUrl", () => {
  it("assumes https when the input has no scheme", () => {
    expect(parseSiteUrl("example.com/login")?.href).toBe("https://example.com/login");
    expect(parseSiteUrl("example.com:8443")?.host).toBe("example.com:8443");
  });

  it("keeps an explicit scheme", () => {
    expect(parseSiteUrl("http://Example.com/a")?.href).toBe("http://example.com/a");
    expect(parseSiteUrl("ftp://files.example.com")?.protocol).toBe("ftp:");
  });

  it("returns null for input that is not a URL", () => {
    expect(parseSiteUrl("")).toBeNull();
    expect(parseSiteUrl("not a host")).toBeNull();
    expect(parseSiteUrl("https://")).toBeNull();
  });
});

describe("siteHostname", () => {
  it("drops a leading www and the port", () => {
    expect(siteHostname("https://www.example.com:8443/x")).toBe("example.com");
    expect(siteHostname("www.example.com")).toBe("example.com");
  });

  it("keeps other subdomains", () => {
    expect(siteHostname("https://accounts.example.com")).toBe("accounts.example.com");
  });

  it("returns null for input that is not a URL", () => {
    expect(siteHostname("not a host")).toBeNull();
  });
});

describe("registrableDomain", () => {
  it("groups subdomains of an ordinary site", () => {
    expect(registrableDomain("https://accounts.google.com/signin")).toBe("google.com");
    expect(registrableDomain("www.github.com")).toBe("github.com");
    expect(registrableDomain("https://shop.example.com.vn")).toBe("example.com.vn");
  });

  it("keeps tenants of shared hosting apart", () => {
    expect(registrableDomain("https://alice.github.io")).toBe("alice.github.io");
    expect(registrableDomain("https://alice.github.io")).not.toBe(
      registrableDomain("https://mallory.github.io"),
    );
    expect(registrableDomain("https://personal-vault.linhdv.workers.dev")).toBe(
      "linhdv.workers.dev",
    );
  });

  it("never collapses IP addresses", () => {
    expect(registrableDomain("http://192.168.1.1")).toBe("192.168.1.1");
    expect(registrableDomain("http://10.0.1.1")).toBe("10.0.1.1");
    expect(registrableDomain("http://[::1]:8080")).toBe("[::1]");
  });

  it("returns null for input that is not a URL", () => {
    expect(registrableDomain("not a host")).toBeNull();
  });
});

describe("siteOf", () => {
  it("folds sign-in subdomains into the registrable domain", () => {
    expect(siteOf("https://accounts.google.com/signin")).toBe("google.com");
    expect(siteOf("https://login.example.co.uk")).toBe("example.co.uk");
  });

  it("keeps other subdomains as their own site", () => {
    expect(siteOf("https://mail.google.com")).toBe("mail.google.com");
    expect(siteOf("https://a.login.example.com")).toBe("a.login.example.com");
  });

  it("treats the bare and www host as the registrable domain", () => {
    expect(siteOf("https://www.example.com")).toBe("example.com");
  });
});
