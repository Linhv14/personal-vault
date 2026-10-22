// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { href, parseHash } from "../extension/console/router.js";

const ORG = "b12e963c-f0dc-4a12-8093-05cc2e0d8926";

describe("console routes", () => {
  it("round-trips every page through the hash", () => {
    const routes = [
      { page: "projects" },
      { page: "project", projectId: "p1", environmentId: null },
      { page: "project", projectId: "p1", environmentId: "env1" },
      { page: "teams" },
      { page: "team", teamId: "t1" },
      { page: "members" },
      { page: "activity" },
      { page: "settings" },
    ] as const;
    for (const route of routes) {
      expect(parseHash(href(ORG, route))).toEqual({ orgId: ORG, route });
    }
  });

  it("falls back to the projects list for an empty or unknown hash", () => {
    expect(parseHash("")).toEqual({ orgId: null, route: { page: "projects" } });
    expect(parseHash(`#/${ORG}/nowhere`)).toEqual({ orgId: ORG, route: { page: "projects" } });
  });
});
