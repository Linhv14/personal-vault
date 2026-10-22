import { now } from "#worker/clock.js";
import type { Env } from "#worker/types.js";
import { checkLicense, licenseAllows, type LicenseCheck } from "#commercial/core/license.js";
import { LICENSE_PUBLIC_KEY } from "#commercial/core/license-key.js";
import { ENTERPRISE_PLAN, SSO_FEATURE } from "#commercial/core/sso-model.js";
import { ssoEnv, testIdpEnabled } from "./env.js";

export async function licenseStatus(env: Env, requestUrl: string): Promise<LicenseCheck> {
  const vars = ssoEnv(env);
  const testKey =
    testIdpEnabled(env, requestUrl) && vars.SSO_TEST_LICENSE_KEY ? [vars.SSO_TEST_LICENSE_KEY] : [];
  return checkLicense(vars.LICENSE_KEY, [LICENSE_PUBLIC_KEY, ...testKey], now());
}

export async function ssoAvailable(
  env: Env,
  requestUrl: string,
  plan: string | null | undefined,
): Promise<boolean> {
  if (plan === ENTERPRISE_PLAN) {
    return true;
  }
  return licenseAllows(await licenseStatus(env, requestUrl), SSO_FEATURE);
}

export async function licensedSeats(env: Env, requestUrl: string): Promise<number> {
  const check = await licenseStatus(env, requestUrl);
  return licenseAllows(check, SSO_FEATURE) && check.status === "valid" ? check.license.seats : 0;
}
