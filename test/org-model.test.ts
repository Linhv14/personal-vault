import { describe, expect, it } from "vitest";
import { utf8Decode } from "../src/core/bytes.js";
import { planLimits, teamKeyContext } from "../src/core/org-model.js";

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
