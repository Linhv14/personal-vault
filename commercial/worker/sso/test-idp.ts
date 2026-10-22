import { fromBase64Url, utf8Decode } from "#core/bytes.js";
import { validJwks } from "#worker/jwt.js";
import type { Env } from "#worker/types.js";
import { ssoEnv } from "./env.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

async function tokenResponse(init: RequestInit | undefined): Promise<Response> {
  const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
  const code = form.get("code");
  if (form.get("grant_type") !== "authorization_code" || !code || !form.get("code_verifier")) {
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  }
  return json({ access_token: "test-access-token", token_type: "Bearer", id_token: code });
}

export function testIdpFetcher(env: Env, network: Fetcher): Fetcher {
  const issuer = ssoEnv(env).SSO_TEST_ISSUER ?? "";
  const keys = env.CI_TEST_JWKS ?? "";
  return async (url, init) => {
    if (!issuer || !url.startsWith(`${issuer}/`)) {
      return network(url, init);
    }
    const path = url.slice(issuer.length);
    if (path === "/.well-known/openid-configuration") {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (path === "/jwks") {
      return json({ keys: validJwks(JSON.parse(utf8Decode(fromBase64Url(keys)))) });
    }
    if (path === "/token" && init?.method === "POST") {
      return tokenResponse(init);
    }
    return new Response("Not found", { status: 404 });
  };
}
