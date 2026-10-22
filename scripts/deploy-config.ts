import { parse, stringify } from "smol-toml";

export interface DeployOptions {
  registrationMode: "token" | "open";
  customDomain: string | null;
  aliasDomains: string[];
  emailFrom: string | null;
  emailProvider: EmailProvider;
  turnstileSiteKey: string | null;
}

type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

const EMAIL_PROVIDERS = ["resend", "cloudflare"] as const;

export const DEFAULT_DEPLOY_OPTIONS: Readonly<DeployOptions> = Object.freeze({
  registrationMode: "token",
  customDomain: null,
  aliasDomains: [],
  emailFrom: null,
  emailProvider: "resend",
  turnstileSiteKey: null,
});

function isEmailProvider(value: string): value is EmailProvider {
  return (EMAIL_PROVIDERS as readonly string[]).includes(value);
}
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TURNSTILE_SITE_KEY = /^[0-9a-zA-Z_-]{10,64}$/;

function clearable(value: string): string | null {
  return value === "none" ? null : value;
}

export function parseDeployFlags(argv: readonly string[]): Partial<DeployOptions> {
  const flags: Partial<DeployOptions> = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const takeValue = () => {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      return value;
    };

    switch (flag) {
      case "--open-registration":
        flags.registrationMode = "open";
        break;
      case "--token-registration":
        flags.registrationMode = "token";
        break;
      case "--domain": {
        const domain = clearable(takeValue().toLowerCase());
        if (domain && !HOSTNAME.test(domain)) {
          throw new Error(`Not a hostname: ${domain}`);
        }
        flags.customDomain = domain;
        break;
      }
      case "--email-from": {
        const address = clearable(takeValue());
        if (address && !EMAIL.test(address)) {
          throw new Error(`Not an email address: ${address}`);
        }
        flags.emailFrom = address;
        break;
      }
      case "--email-provider": {
        const provider = takeValue();
        if (!isEmailProvider(provider)) {
          throw new Error(`--email-provider must be one of: ${EMAIL_PROVIDERS.join(", ")}`);
        }
        flags.emailProvider = provider;
        break;
      }
      case "--turnstile-site-key": {
        const siteKey = clearable(takeValue());
        if (siteKey && !TURNSTILE_SITE_KEY.test(siteKey)) {
          throw new Error(`Not a Turnstile site key: ${siteKey}`);
        }
        flags.turnstileSiteKey = siteKey;
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return flags;
}

export function resolveDeployOptions(
  saved: Record<string, unknown> = {},
  flags: Partial<DeployOptions> = {},
): DeployOptions {
  const known = Object.fromEntries(
    Object.keys(DEFAULT_DEPLOY_OPTIONS)
      .filter((key) => saved[key] !== undefined)
      .map((key) => [key, saved[key]]),
  ) as Partial<DeployOptions>;
  return { ...DEFAULT_DEPLOY_OPTIONS, ...known, ...flags };
}

export function requiredSecrets(options: DeployOptions): string[] {
  const secrets = ["REGISTRATION_TOKEN", "EMAIL_PROBE_SECRET", "AT_REST_SECRET"];
  if (options.emailFrom && options.emailProvider === "resend") {
    secrets.push("RESEND_API_KEY");
  }
  if (options.turnstileSiteKey) {
    secrets.push("TURNSTILE_SECRET");
  }
  return secrets;
}

interface WranglerConfig {
  account_id?: string;
  d1_databases?: { binding: string; database_id?: string }[];
  vars?: Record<string, string>;
  routes?: { pattern: string; custom_domain: boolean }[];
  workers_dev?: boolean;
  send_email?: { name: string }[];
  secrets?: { required: string[] };
}

export function renderConfig(
  template: string,
  input: { accountId: string; databaseId: string; options: DeployOptions },
): string {
  const { accountId, databaseId, options } = input;
  const config = parse(template) as WranglerConfig;
  const database = config.d1_databases?.find((binding) => binding.binding === "DB");
  if (!database) {
    throw new Error('wrangler.toml has no D1 binding named "DB"');
  }

  database.database_id = databaseId;
  config.account_id = accountId;
  const vars: Record<string, string> = {
    ...config.vars,
    REGISTRATION_MODE: options.registrationMode,
  };
  config.vars = vars;

  if (options.customDomain) {
    const domains = [options.customDomain, ...options.aliasDomains];
    for (const domain of domains) {
      if (!HOSTNAME.test(domain)) {
        throw new Error(`Not a hostname: ${domain}`);
      }
    }
    config.routes = domains.map((pattern) => ({ pattern, custom_domain: true }));
    config.workers_dev = true;
  }
  if (options.emailFrom) {
    vars.EMAIL_FROM = options.emailFrom;
    if (options.emailProvider === "cloudflare") {
      config.send_email = [{ name: "EMAIL" }];
    }
  }

  if (options.turnstileSiteKey) {
    vars.TURNSTILE_SITE_KEY = options.turnstileSiteKey;
  }

  config.secrets = { required: requiredSecrets(options) };

  return `# Generated by \`npm run deploy\` from wrangler.toml. Do not edit.\n\n${stringify(config)}\n`;
}
