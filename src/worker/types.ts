export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Required to register. Without it your Worker is a public signup page. */
  REGISTRATION_TOKEN: string;
  /** HMAC key used to fabricate KDF params for addresses that do not exist. */
  EMAIL_PROBE_SECRET: string;
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
