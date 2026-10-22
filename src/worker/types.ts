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
  REGISTRATION_TOKEN: string;
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

export type AppBindings = {
  Bindings: Env;
  Variables: { session: SessionContext };
};
