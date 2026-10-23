import type { OrgStore } from "./orgs/org-object.js";
import type { StoreEnv } from "./store-env.js";
import type { UserStore } from "./user-vault-object.js";

export interface Env extends StoreEnv {
  USER_STORE: DurableObjectNamespace<UserStore>;
  ORG_STORE: DurableObjectNamespace<OrgStore>;
  ASSETS: Fetcher;
  SITE?: Fetcher;
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
  PRIVACY_URL?: string;
  CI_TEST_JWKS?: string;
  CI_TEST_ISSUER?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ATTACHMENTS?: string;
  FILE_MAX_BYTES?: string;
  ACCOUNT_FILES_BYTES?: string;
}

export interface SessionContext {
  accountId: string;
  tokenHash: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { session: SessionContext };
};
