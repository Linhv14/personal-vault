import type { Env } from "#worker/types.js";

export type SsoEnv = Env & {
  LICENSE_KEY?: string;
  SSO_EXTENSION_IDS?: string;
  SSO_TEST_ISSUER?: string;
  SSO_TEST_LICENSE_KEY?: string;
};

export const ssoEnv = (env: Env): SsoEnv => env;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function testIdpEnabled(env: Env, requestUrl: string): boolean {
  const vars = ssoEnv(env);
  return (
    LOCAL_HOSTS.has(new URL(requestUrl).hostname) &&
    Boolean(vars.SSO_TEST_ISSUER) &&
    Boolean(vars.CI_TEST_JWKS)
  );
}
