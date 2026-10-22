import type { Context } from "hono";
import { randomBytes, toBase64Url } from "#core/bytes.js";
import { sealServerSecret } from "#worker/at-rest.js";
import { hashToken } from "#worker/session.js";
import type { AppBindings } from "#worker/types.js";
import { callbackUrl, SSO_SCOPES } from "#commercial/core/sso-model.js";
import { ssoFetcher } from "./fetcher.js";
import { discover, pkceChallenge } from "./oidc.js";
import type { SsoConfig, SsoStore } from "./store.js";

type Ctx = Context<AppBindings>;

export type ReadyConfig = SsoConfig & { issuer: string; clientId: string; clientSecret: string };

const STATE_TTL_SECONDS = 600;
export const CODE_VERIFIER_PURPOSE = "sso-code-verifier";
export const CLIENT_SECRET_PURPOSE = "sso-client-secret";

export const token = () => toBase64Url(randomBytes(32));
export const origin = (c: Ctx) => new URL(c.req.url).origin;

export function backTo(c: Ctx, returnTo: string, fragment: Record<string, string>) {
  return c.redirect(`${returnTo}#${new URLSearchParams(fragment).toString()}`, 302);
}

export function ready(config: SsoConfig | null): config is ReadyConfig {
  return Boolean(config?.enabled && config.issuer && config.clientId && config.clientSecret);
}

export async function authorizationUrl(
  c: Ctx,
  store: SsoStore,
  config: ReadyConfig,
  request: {
    returnTo: string;
    clientChallenge: string;
    loginHint: string | null;
    linkAccountId: string | null;
  },
): Promise<string | null> {
  const metadata = await discover(ssoFetcher(c.env, c.req.url), config.issuer);
  if (!metadata) {
    return null;
  }
  const state = token();
  const nonce = token();
  const codeVerifier = token();
  await store.putState(
    await hashToken(state),
    {
      orgId: config.orgId,
      codeVerifier: await sealServerSecret(c.env, CODE_VERIFIER_PURPOSE, codeVerifier),
      nonce,
      clientChallenge: request.clientChallenge,
      returnTo: request.returnTo,
      linkAccountId: request.linkAccountId,
    },
    STATE_TTL_SECONDS,
  );
  const authorize = new URL(metadata.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: callbackUrl(origin(c)),
    scope: SSO_SCOPES,
    state,
    nonce,
    code_challenge: await pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
  };
  if (request.loginHint) {
    params.login_hint = request.loginHint;
  }
  for (const [name, value] of Object.entries(params)) {
    authorize.searchParams.set(name, value);
  }
  return authorize.href;
}
