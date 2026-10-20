import type { OrgStore } from "./orgs/store.js";
import type { UserStore } from "./user-store.js";

export interface Env {
  DB: D1Database;
  USER_STORE: DurableObjectNamespace<UserStore>;
  ORG_STORE: DurableObjectNamespace<OrgStore>;
  ASSETS: Fetcher;
  ANONYMOUS_RATE_LIMITER: RateLimit;
  REGISTRATION_RATE_LIMITER: RateLimit;
  ACCOUNT_RATE_LIMITER: RateLimit;
  REGISTRATION_MODE: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  /** Required to register. Without it your Worker is a public signup page. */
  REGISTRATION_TOKEN: string;
  /** HMAC key used to fabricate KDF params for addresses that do not exist. */
  EMAIL_PROBE_SECRET: string;
  AT_REST_SECRET: string;
  MIGRATION_TOKEN?: string;
  ALIAS_ORIGINS?: string;
  READ_ONLY?: string;
  SECURITY_CONTACT?: string;
  CI_TEST_JWKS?: string;
  CI_TEST_ISSUER?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

export interface SessionContext {
  accountId: string;
  tokenHash: string;
}

/** Hono context variables, declared so `c.get("session")` is typed. */
export type AppBindings = {
  Bindings: Env;
  Variables: { session: SessionContext };
};
