export interface Env {
  DB: D1Database;
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
