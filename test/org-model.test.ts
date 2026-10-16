import { describe, expect, it } from "vitest";
import { utf8Decode } from "../src/core/bytes.js";
import {
  isDomainAllowed,
  normalizeDomain,
  parseDomains,
  planLimits,
  teamKeyContext,
} from "../src/core/org-model.js";

describe("organization model", () => {
  it("binds a wrapped team key to its team and generation", () => {
    expect(utf8Decode(teamKeyContext("t1", 0))).toBe("personal-vault/team-key/t1");
    expect(utf8Decode(teamKeyContext("t1", 2))).toBe("personal-vault/team-key/t1/2");
  });

  it("treats an unknown plan as the free plan", () => {
    expect(planLimits("enterprise-trial")).toEqual(planLimits("free"));
    expect(planLimits("team").seats).toBeGreaterThan(planLimits("free").seats);
  });
});

describe("allowed email domains", () => {
  it("normalizes domains and rejects anything that is not a hostname", () => {
    expect(normalizeDomain(" @Acme.COM. ")).toBe("acme.com");
    expect(normalizeDomain("eu.acme.co.uk")).toBe("eu.acme.co.uk");
    for (const bad of ["acme", "acme..com", "-acme.com", "acme.com/x", "a b.com", "", 42]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });

  it("parses a list once, dedupes it, and refuses the whole list on one bad entry", () => {
    expect(parseDomains(["acme.com", "ACME.com", "acme.vn"])).toEqual(["acme.com", "acme.vn"]);
    expect(parseDomains(["acme.com", "nope"])).toBeNull();
    expect(parseDomains("acme.com")).toBeNull();
    expect(parseDomains(Array.from({ length: 11 }, (_, n) => `d${n}.com`))).toBeNull();
    expect(parseDomains([])).toEqual([]);
  });

  it("allows every address when no domain is set, otherwise only exact domains", () => {
    expect(isDomainAllowed("a@gmail.com", [])).toBe(true);
    expect(isDomainAllowed("A@Acme.com", ["acme.com"])).toBe(true);
    expect(isDomainAllowed("a@eu.acme.com", ["acme.com"])).toBe(false);
    expect(isDomainAllowed("a@acme.com.evil.io", ["acme.com"])).toBe(false);
    expect(isDomainAllowed("a@acme.com@evil.io", ["acme.com"])).toBe(false);
  });
});
