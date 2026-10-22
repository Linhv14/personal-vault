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

describe("Turnstile deploy option", () => {
  it("reads and clears the site key", () => {
    expect(parseDeployFlags(["--turnstile-site-key", "0x4AAAAAAAB1cD2eF3gH4iJ5"])).toEqual({
      turnstileSiteKey: "0x4AAAAAAAB1cD2eF3gH4iJ5",
    });
    expect(parseDeployFlags(["--turnstile-site-key", "none"])).toEqual({ turnstileSiteKey: null });
    expect(() => parseDeployFlags(["--turnstile-site-key", "not a key"])).toThrow(/Turnstile/);
  });

  it("publishes the site key as a var and requires the secret only when set", () => {
    expect(render().vars.TURNSTILE_SITE_KEY).toBeUndefined();
    expect(requiredSecrets(DEFAULT_DEPLOY_OPTIONS)).not.toContain("TURNSTILE_SECRET");
    const config = render({ turnstileSiteKey: "0x4AAAAAAAB1cD2eF3gH4iJ5" });
    expect(config.vars.TURNSTILE_SITE_KEY).toBe("0x4AAAAAAAB1cD2eF3gH4iJ5");
    expect(config.secrets.required).toContain("TURNSTILE_SECRET");
  });

  it("picks the site key up from deploy/production.json", () => {
    expect(
      resolveDeployOptions({ turnstileSiteKey: "0x4AAAAAAAB1cD2eF3gH4iJ5" }).turnstileSiteKey,
    ).toBe("0x4AAAAAAAB1cD2eF3gH4iJ5");
  });
});

describe("site service option", () => {
  it("reads and clears the Worker name", () => {
    expect(parseDeployFlags(["--site-service", "7key-site"])).toEqual({
      siteService: "7key-site",
    });
    expect(parseDeployFlags(["--site-service", "none"])).toEqual({ siteService: null });
    expect(() => parseDeployFlags(["--site-service", "Not A Worker"])).toThrow(/Worker name/);
  });

  it("binds no site by default, so self-hosted servers serve their own home page", () => {
    expect(DEFAULT_DEPLOY_OPTIONS.siteService).toBeNull();
    expect(render().services).toBeUndefined();
  });

  it("binds SITE to the named Worker", () => {
    expect(render({ siteService: "7key-site" }).services).toEqual([
      { binding: "SITE", service: "7key-site" },
    ]);
    expect(() => render({ siteService: "bad name" })).toThrow(/Worker name/);
  });

  it("picks the site service up from deploy/production.json", () => {
    const production = JSON.parse(
      readFileSync(new URL("../deploy/production.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(resolveDeployOptions(production).siteService).toBe("7key-site");
    expect(resolveDeployOptions({}).siteService).toBeNull();
  });
});

describe("privacy url option", () => {
  it("reads and clears the address, and rejects anything but https", () => {
    expect(parseDeployFlags(["--privacy-url", "https://example.test/privacy"])).toEqual({
      privacyUrl: "https://example.test/privacy",
    });
    expect(parseDeployFlags(["--privacy-url", "none"])).toEqual({ privacyUrl: null });
    expect(() => parseDeployFlags(["--privacy-url", "http://example.test"])).toThrow(/https/);
    expect(() => parseDeployFlags(["--privacy-url", "/privacy"])).toThrow(/https/);
  });

  it("sets no PRIVACY_URL by default, so self-hosted servers link no policy", () => {
    expect(DEFAULT_DEPLOY_OPTIONS.privacyUrl).toBeNull();
    expect(render().vars.PRIVACY_URL).toBeUndefined();
  });

  it("writes PRIVACY_URL when set", () => {
    expect(render({ privacyUrl: "https://example.test/privacy" }).vars.PRIVACY_URL).toBe(
      "https://example.test/privacy",
    );
    expect(() => render({ privacyUrl: "ftp://example.test" })).toThrow(/https/);
  });

  it("picks the address up from deploy/production.json", () => {
    const production = JSON.parse(
      readFileSync(new URL("../deploy/production.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(resolveDeployOptions(production).privacyUrl).toBe("https://7key.online/privacy");
    expect(resolveDeployOptions({}).privacyUrl).toBeNull();
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
