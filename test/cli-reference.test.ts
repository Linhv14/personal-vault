import { describe, expect, it, vi } from "vitest";
import { parseFlags } from "../cli/account/commands.js";
import {
  injectTemplate,
  parseReference,
  templateReferences,
  type Scope,
} from "../cli/account/reference.js";
import { AgentError } from "../cli/agent/session.js";

const environments: Record<string, Record<string, string>> = {
  "": { DATABASE_URL: "postgres://linked", API_KEY: "linked-key" },
  "payments-api\nproduction": { STRIPE_KEY: "sk_live_9", WEIRD: "a}}b\n{{ 7key:API_KEY }}" },
  "payments-api\ndevelopment": { STRIPE_KEY: "sk_test_1" },
};

function loader() {
  return vi.fn(async (scope: Scope) => {
    const key = scope.project ? `${scope.project}\n${scope.environment}` : "";
    const values = environments[key];
    if (!values) throw new AgentError(`No project "${scope.project}" in your teams`);
    return { secrets: Object.entries(values).map(([name, value]) => ({ name, value })) };
  });
}

describe("secret references", () => {
  it("parses full references, bare names and the shorthand", () => {
    expect(parseReference("7key://payments-api/production/STRIPE_KEY")).toEqual({
      text: "7key://payments-api/production/STRIPE_KEY",
      project: "payments-api",
      environment: "production",
      name: "STRIPE_KEY",
    });
    expect(parseReference("STRIPE_KEY")).toEqual({ text: "STRIPE_KEY", name: "STRIPE_KEY" });
    expect(parseReference("7key:STRIPE_KEY")).toEqual({
      text: "7key:STRIPE_KEY",
      name: "STRIPE_KEY",
    });
  });

  it("rejects malformed references", () => {
    for (const bad of ["", "7key://only/two", "7key://a//NAME", "7key://a/b/c/d", "A/B", "7key:"]) {
      expect(() => parseReference(bad)).toThrow(AgentError);
    }
  });

  it("finds references with or without spaces inside the braces", () => {
    const found = templateReferences(
      "a={{7key:API_KEY}} b={{ 7key:API_KEY }} c={{   7key://p/e/N\t}} d={{ other }} e={ 7key:X }",
    );
    expect(found.map((entry) => entry.text)).toEqual([
      "7key:API_KEY",
      "7key:API_KEY",
      "7key://p/e/N",
    ]);
  });

  it("fills a template, fetching each environment once", async () => {
    const load = loader();
    const result = await injectTemplate(
      [
        "DB={{ 7key:DATABASE_URL }}",
        "KEY={{7key:API_KEY}}",
        "LIVE={{ 7key://payments-api/production/STRIPE_KEY }}",
        "TEST={{ 7key://payments-api/development/STRIPE_KEY }}",
        "AGAIN={{ 7key://payments-api/production/STRIPE_KEY}}",
        "",
      ].join("\n"),
      load,
    );
    expect(result.missing).toEqual([]);
    expect(result.count).toBe(5);
    expect(result.text).toBe(
      "DB=postgres://linked\nKEY=linked-key\nLIVE=sk_live_9\nTEST=sk_test_1\nAGAIN=sk_live_9\n",
    );
    expect(load).toHaveBeenCalledTimes(3);
    expect(result.loaded).toHaveLength(3);
  });

  it("inserts values holding braces or newlines verbatim, without expanding them", async () => {
    const result = await injectTemplate("x={{ 7key://payments-api/production/WEIRD }};", loader());
    expect(result.text).toBe("x=a}}b\n{{ 7key:API_KEY }};");
    expect(result.count).toBe(1);
  });

  it("lists every missing reference and fills nothing", async () => {
    const template =
      "{{ 7key:API_KEY }} {{ 7key:NOPE }} {{ 7key://payments-api/production/GONE }} {{ 7key://ghost/prod/X }} {{ 7key:NOPE }}";
    const result = await injectTemplate(template, loader());
    expect(result.count).toBe(0);
    expect(result.text).toBe(template);
    expect(result.missing).toEqual([
      "7key:NOPE",
      "7key://payments-api/production/GONE",
      '7key://ghost/prod/X (No project "ghost" in your teams)',
    ]);
  });

  it("leaves a template without references as it is", async () => {
    const load = loader();
    const result = await injectTemplate("plain {{ text }}\n", load);
    expect(result).toMatchObject({ text: "plain {{ text }}\n", count: 0, missing: [] });
    expect(load).not.toHaveBeenCalled();
  });

  it("parses read and inject flags", () => {
    expect(parseFlags(["7key://p/e/N", "--org", "acme"], { positional: true }).positional).toEqual([
      "7key://p/e/N",
    ]);
    expect(parseFlags(["-i", "in.tpl", "-o", ".env", "--force"])).toMatchObject({
      input: "in.tpl",
      output: ".env",
      force: true,
    });
    expect(() => parseFlags(["stray"])).toThrow("Unexpected argument");
  });
});
