import { Hono, type Context } from "hono";
import { fromBase64Url, utf8Decode } from "#core/bytes.js";
import { parseLinkReference } from "#core/ci.js";
import { apiError } from "../errors.js";
import { githubJwks, validJwks, verifyGithubToken, type JwksSource } from "../github-oidc.js";
import { now } from "../clock.js";
import { readJson, respond } from "../http.js";
import { clientIp } from "../request.js";
import { orgStore } from "../durable-objects.js";
import type { AppBindings } from "../types.js";
import { isUuid } from "../validate.js";

const ci = new Hono<AppBindings>();

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function trustSource(c: Context<AppBindings>): { jwks: JwksSource; issuer?: string } {
  const local = LOCAL_HOSTS.has(new URL(c.req.url).hostname);
  const testKeys = c.env.CI_TEST_JWKS;
  if (local && testKeys) {
    return {
      jwks: async () => validJwks(JSON.parse(utf8Decode(fromBase64Url(testKeys)))),
      issuer: c.env.CI_TEST_ISSUER,
    };
  }
  return { jwks: githubJwks };
}

ci.post("/secrets", async (c) => {
  const { link } = await readJson(c);
  const reference = typeof link === "string" ? parseLinkReference(link) : null;
  if (!reference || !isUuid(reference.orgId) || !isUuid(reference.linkId)) {
    return c.json(apiError("ci.forbidden"), 403);
  }
  const { success } = await c.env.ANONYMOUS_RATE_LIMITER.limit({ key: `ci:${reference.linkId}` });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }

  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = await verifyGithubToken(token, {
    audience: [
      new URL(c.req.url).origin,
      ...(c.env.ALIAS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
    now: now(),
    ...trustSource(c),
  });
  if (!claims) {
    return c.json(apiError("ci.unauthorized"), 401);
  }

  return respond(
    c,
    await orgStore(c.env, reference.orgId).ciRead(reference.linkId, claims, clientIp(c)),
  );
});

export default ci;
