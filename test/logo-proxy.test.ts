import { describe, expect, it } from "vitest";
import { logoDomain, logoSources } from "../src/worker/logo.js";

describe("website logo proxy", () => {
  it("accepts plain hostnames only", () => {
    expect(logoDomain("GitHub.com")).toBe("github.com");
    expect(logoDomain("account.proton.me.")).toBe("account.proton.me");
    for (const bad of [
      "",
      "localhost",
      "127.0.0.1",
      "github.com/evil",
      "github.com?x=1",
      "user@github.com",
      "-bad.com",
      "a..com",
      `${"a".repeat(64)}.com`,
    ]) {
      expect(logoDomain(bad), bad).toBeNull();
    }
  });

  it("only ever asks fixed icon services, with the domain as a parameter", () => {
    for (const source of logoSources("github.com")) {
      const url = new URL(source);
      expect(["icons.duckduckgo.com", "www.google.com"]).toContain(url.hostname);
      expect(url.protocol).toBe("https:");
    }
  });
});
