import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import {
  DEFAULT_DEPLOY_OPTIONS,
  parseDeployFlags,
  renderConfig,
  requiredSecrets,
  resolveDeployOptions,
} from "../scripts/deploy-config.ts";

const template = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

function render(options: Partial<typeof DEFAULT_DEPLOY_OPTIONS> = {}) {
  return parse(
    renderConfig(template, {
      accountId: "account-1",
      databaseId: "database-1",
      options: { ...DEFAULT_DEPLOY_OPTIONS, ...options },
    }),
  ) as Record<string, any>;
}

describe("parseDeployFlags", () => {
  it("reads every supported option", () => {
    expect(
      parseDeployFlags([
        "--open-registration",
        "--domain",
        "7KEY.online",
        "--email-from",
        "no-reply@7key.online",
        "--email-provider",
        "cloudflare",
      ]),
    ).toEqual({
      registrationMode: "open",
      customDomain: "7key.online",
      emailFrom: "no-reply@7key.online",
      emailProvider: "cloudflare",
    });
  });

  it("clears a saved value with none", () => {
    expect(parseDeployFlags(["--domain", "none", "--email-from", "none"])).toEqual({
      customDomain: null,
      emailFrom: null,
    });
  });

  it("rejects typos and malformed values before anything is deployed", () => {
    expect(() => parseDeployFlags(["--open-registraton"])).toThrow(/Unknown option/);
    expect(() => parseDeployFlags(["--domain"])).toThrow(/needs a value/);
    expect(() => parseDeployFlags(["--domain", "--open-registration"])).toThrow(/needs a value/);
    expect(() => parseDeployFlags(["--domain", "https://7key.online"])).toThrow(/hostname/);
    expect(() => parseDeployFlags(["--email-from", "no-reply"])).toThrow(/email/);
    expect(() => parseDeployFlags(["--email-provider", "smtp"])).toThrow(/resend, cloudflare/);
  });
});

describe("resolveDeployOptions", () => {
  it("lets flags override what the last deploy saved, and ignores unrelated state", () => {
    expect(
      resolveDeployOptions(
        { registrationMode: "open", customDomain: "7key.online", workerUrl: "https://x" },
        { customDomain: null },
      ),
    ).toEqual({ ...DEFAULT_DEPLOY_OPTIONS, registrationMode: "open", customDomain: null });
  });
});

describe("renderConfig", () => {
  it("fills in the account and database without dropping the template's settings", () => {
    const config = render();
    expect(config.account_id).toBe("account-1");
    expect(config.d1_databases[0].database_id).toBe("database-1");
    expect(config.preview_urls).toBe(false);
    expect(config.ratelimits.map((limit: { name: string }) => limit.name)).toEqual([
      "ANONYMOUS_RATE_LIMITER",
      "REGISTRATION_RATE_LIMITER",
      "ACCOUNT_RATE_LIMITER",
    ]);
    expect(config.triggers.crons).toEqual(["17 * * * *"]);
    expect(config.durable_objects.bindings).toEqual([
      { name: "USER_STORE", class_name: "UserStore" },
      { name: "ORG_STORE", class_name: "OrgStore" },
    ]);
    expect(config.migrations).toEqual([
      { tag: "v1", new_sqlite_classes: ["UserStore"] },
      { tag: "v2", new_sqlite_classes: ["OrgStore"] },
    ]);
    expect(config.vars).toEqual({ REGISTRATION_MODE: "token" });
    expect(config.routes).toBeUndefined();
    expect(config.send_email).toBeUndefined();
  });

  it("keeps workers.dev reachable when a custom domain is added", () => {
    const config = render({ customDomain: "7key.online" });
    expect(config.routes).toEqual([{ pattern: "7key.online", custom_domain: true }]);
    expect(config.workers_dev).toBe(true);
  });

  it("serves alias domains next to the main one", () => {
    const config = render({ customDomain: "vault.example.com", aliasDomains: ["old.example.com"] });
    expect(config.routes).toEqual([
      { pattern: "vault.example.com", custom_domain: true },
      { pattern: "old.example.com", custom_domain: true },
    ]);
    expect(() =>
      render({ customDomain: "vault.example.com", aliasDomains: ["not a host"] }),
    ).toThrow();
  });

  it("declares the secrets a deploy must find on the Worker", () => {
    expect(render().secrets.required).toEqual([
      "REGISTRATION_TOKEN",
      "EMAIL_PROBE_SECRET",
      "AT_REST_SECRET",
    ]);
    expect(
      render({ emailFrom: "no-reply@example.com", emailProvider: "resend" }).secrets.required,
    ).toContain("RESEND_API_KEY");
  });

  it("adds the sender address, and the Email Sending binding only for Cloudflare", () => {
    const resend = render({ emailFrom: "no-reply@7key.online" });
    expect(resend.vars.EMAIL_FROM).toBe("no-reply@7key.online");
    expect(resend.send_email).toBeUndefined();

    const cloudflare = render({ emailFrom: "no-reply@7key.online", emailProvider: "cloudflare" });
    expect(cloudflare.send_email).toEqual([{ name: "EMAIL" }]);
  });

  it("refuses a template without the database binding", () => {
    expect(() =>
      renderConfig('name = "x"', {
        accountId: "a",
        databaseId: "d",
        options: DEFAULT_DEPLOY_OPTIONS,
      }),
    ).toThrow(/D1 binding/);
  });
});

describe("requiredSecrets", () => {
  it("asks for a Resend key only when Resend will send mail", () => {
    expect(requiredSecrets(DEFAULT_DEPLOY_OPTIONS)).not.toContain("RESEND_API_KEY");
    expect(
      requiredSecrets({ ...DEFAULT_DEPLOY_OPTIONS, emailFrom: "no-reply@7key.online" }),
    ).toContain("RESEND_API_KEY");
    expect(
      requiredSecrets({
        ...DEFAULT_DEPLOY_OPTIONS,
        emailFrom: "no-reply@7key.online",
        emailProvider: "cloudflare",
      }),
    ).not.toContain("RESEND_API_KEY");
  });
});
