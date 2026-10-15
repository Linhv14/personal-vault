import { describe, expect, it } from "vitest";
import {
  decodeRepoKey,
  encodeRepoKey,
  isBranch,
  isRepository,
  parseLinkReference,
  ruleAllows,
  type GithubClaims,
} from "../src/core/ci.js";
import { createIdentity } from "../src/core/identity.js";

const claims = (overrides: Partial<GithubClaims> = {}): GithubClaims => ({
  repository: "acme/api",
  ref: "refs/heads/main",
  event_name: "push",
  ...overrides,
});

describe("repository links", () => {
  it("round-trips a repository key through its text form", async () => {
    const identity = await createIdentity();
    const text = encodeRepoKey(identity);
    expect(text.startsWith("1pw1.")).toBe(true);
    expect(decodeRepoKey(text)).toEqual(identity);
    expect(() => decodeRepoKey("ghp_something")).toThrow();
  });

  it("parses link references and rejects anything else", () => {
    expect(parseLinkReference("org-1.link-1")).toEqual({ orgId: "org-1", linkId: "link-1" });
    expect(parseLinkReference("org-1")).toBeNull();
    expect(parseLinkReference("a.b.c")).toBeNull();
  });

  it("accepts only the linked repository on the allowed branch", () => {
    const rule = { repository: "Acme/API", branch: "main", githubEnvironment: null };
    expect(ruleAllows(rule, claims())).toBe(true);
    expect(ruleAllows(rule, claims({ ref: "refs/heads/feature" }))).toBe(false);
    expect(ruleAllows(rule, claims({ ref: "refs/pull/7/merge" }))).toBe(false);
    expect(ruleAllows(rule, claims({ repository: "acme/api-fork" }))).toBe(false);
    expect(ruleAllows(rule, claims({ event_name: "pull_request_target" }))).toBe(false);
  });

  it("requires the GitHub environment when the rule names one, and some rule always", () => {
    const rule = { repository: "acme/api", branch: null, githubEnvironment: "production" };
    expect(ruleAllows(rule, claims({ environment: "production" }))).toBe(true);
    expect(ruleAllows(rule, claims())).toBe(false);
    expect(ruleAllows({ ...rule, githubEnvironment: null }, claims())).toBe(false);
  });

  it("validates repository and branch names", () => {
    expect(isRepository("acme/api.web")).toBe(true);
    expect(isRepository("acme")).toBe(false);
    expect(isRepository("acme/api/x")).toBe(false);
    expect(isBranch("release/2026")).toBe(true);
    expect(isBranch("../main")).toBe(false);
  });
});
