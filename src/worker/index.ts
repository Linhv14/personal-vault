import { Hono } from "hono";
import { mountCommercial } from "#commercial/worker/index.js";
import ci from "./routes/ci.js";
import { logError, logInfo } from "./log.js";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { apiError } from "./errors.js";
import { InvalidBodyError } from "./http.js";
import account from "./routes/account.js";
import auth from "./routes/auth/index.js";
import deviceUnlock from "./routes/device-unlock.js";
import items from "./routes/items.js";
import orgs, { invites } from "./routes/orgs.js";
import logos from "./routes/logos.js";
import migration from "./routes/migration.js";
import vaults from "./routes/vaults.js";
import shares from "./routes/shares.js";
import { emailVerificationEnabled } from "./email-verification.js";
import { clientIp, isOpenRegistration } from "./request.js";
import { resolveSession, SESSION_IDLE_SECONDS } from "./session.js";
import { securityTxt, SHARE_PAGE_HEADERS, STRICT_TRANSPORT_SECURITY } from "./security-headers.js";
import { PAIR_MEMORY_SECONDS } from "./throttle-policy.js";
import { apiCatalog } from "./discovery.js";
import { configuredPrivacyUrl, fillPrivacyLink } from "./privacy-link.js";
import { MARKDOWN_PAGES, SITE_PAGES } from "./markdown-negotiation.js";
import { serveFromSite, servePage } from "./markdown-pages.js";
import {
  requireHuman,
  TURNSTILE_HEADER,
  turnstileFrameHeaders,
  turnstileFramePage,
  turnstileSiteKey,
} from "./turnstile.js";
import type { AppBindings, Env } from "./types.js";

const app = new Hono<AppBindings>();

app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")
        ? origin
        : null,
    allowHeaders: ["Content-Type", "Authorization", "X-Registration-Token", TURNSTILE_HEADER],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86_400,
  }),
);

app.use("/api/*", async (c, next) => {
  await next();
  c.res = new Response(c.res.body, c.res);
  const headers = c.res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (new URL(c.req.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  }
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
});

app.use("/api/*", async (c, next) => {
  const reading = c.req.method === "GET" || c.req.method === "OPTIONS";
  if (c.env.READ_ONLY === "1" && !reading && !c.req.path.startsWith("/api/migration/")) {
    return c.json(apiError("server.read_only"), 503);
  }
  await next();
});

const limitByClientIp: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { success } = await c.env.ANONYMOUS_RATE_LIMITER.limit({ key: clientIp(c) });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }
  await next();
};

const limitRegistrationsByIp: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { success } = await c.env.REGISTRATION_RATE_LIMITER.limit({ key: clientIp(c) });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }
  await next();
};

app.use("/api/auth/register", limitRegistrationsByIp);
app.use("/api/auth/verify-email", limitRegistrationsByIp);
app.use("/api/auth/verify-email", limitByClientIp);

app.use("/api/auth/register", limitByClientIp);
app.use("/api/auth/prelogin", limitByClientIp);
app.use("/api/auth/login", limitByClientIp);
app.use("/api/auth/login/2fa", limitByClientIp);
app.use("/api/auth/recover/*", limitByClientIp);
app.on("GET", "/api/shares/*", limitByClientIp);
app.on("POST", ["/api/shares/:id/code", "/api/shares/:id/open"], limitByClientIp);

app.use("/api/auth/register", requireHuman);
app.use("/api/auth/verify-email", requireHuman);
app.use("/api/auth/recover/email", requireHuman);
app.use("/api/auth/recover/start", requireHuman);
app.on("POST", "/api/shares/:id/code", requireHuman);

const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = await resolveSession(c.env, c.req.header("Authorization"));
  if (!session) {
    return c.json(apiError("auth.unauthorized"), 401);
  }
  c.set("session", session);
  await next();
};

app.use("/api/items", requireAuth);
app.use("/api/items/*", requireAuth);
app.use("/api/logo", requireAuth);
app.use("/api/auth/logout", requireAuth);
app.use("/api/auth/resume-key", requireAuth);
app.use("/api/auth/pin", requireAuth);
app.use("/api/auth/pin/*", requireAuth);
app.use("/api/auth/biometric", requireAuth);
app.use("/api/auth/biometric/*", requireAuth);
app.use("/api/auth/change-password", requireAuth);
app.use("/api/auth/sessions", requireAuth);
app.use("/api/auth/sessions/*", requireAuth);
app.use("/api/account/*", requireAuth);
app.use("/api/orgs", requireAuth);
app.use("/api/vaults", requireAuth);
app.use("/api/orgs/*", requireAuth);
app.use("/api/invites", requireAuth);
const authUnlessInvitePreview: MiddlewareHandler<AppBindings> = async (c, next) =>
  c.req.method === "GET" && c.req.path.endsWith("/preview") ? next() : requireAuth(c, next);
app.use("/api/invites/*", authUnlessInvitePreview);
app.use("/api/auth/delete-account", requireAuth);

const authToCreateShare: MiddlewareHandler<AppBindings> = async (c, next) =>
  c.req.method === "POST" ? requireAuth(c, next) : next();
app.use("/api/shares", authToCreateShare);

const limitWritesByAccount: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method === "GET") {
    return next();
  }
  const { success } = await c.env.ACCOUNT_RATE_LIMITER.limit({
    key: c.get("session").accountId,
  });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }
  await next();
};

app.use("/api/items/*", limitWritesByAccount);
app.use("/api/orgs", limitWritesByAccount);
app.use("/api/orgs/*", limitWritesByAccount);
app.use("/api/invites/*", limitWritesByAccount);
app.use("/api/account/*", limitWritesByAccount);
app.use("/api/auth/sessions/*", limitWritesByAccount);
const limitShareCreation: MiddlewareHandler<AppBindings> = async (c, next) =>
  c.req.method === "POST" ? limitWritesByAccount(c, next) : next();
app.use("/api/shares", limitShareCreation);
app.use("/api/shares/status", requireAuth);
app.on("DELETE", "/api/shares/*", requireAuth);
app.on("DELETE", "/api/shares/*", limitWritesByAccount);

app.get("/api/config", (c) => {
  const siteKey = turnstileSiteKey(c.env);
  const privacy = configuredPrivacyUrl(c.env);
  return c.json({
    registration: isOpenRegistration(c.env) ? "open" : "token",
    emailVerification: emailVerificationEnabled(c.env),
    ...(siteKey ? { turnstileSiteKey: siteKey } : {}),
    ...(privacy ? { privacyUrl: privacy } : {}),
  });
});

app.route("/api/auth", auth);
app.route("/api/auth", deviceUnlock);
app.route("/api/account", account);
app.route("/api/orgs", orgs);
app.route("/api/vaults", vaults);
app.route("/api/invites", invites);
app.route("/api/items", items);
app.route("/api/logo", logos);
app.route("/api/shares", shares);
app.route("/api/ci", ci);
app.route("/api/migration", migration);
mountCommercial(app);

app.get("/api/time", (c) => c.json({ serverTime: Math.floor(Date.now() / 1000) }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/.well-known/agent-skills/index.json", async (c) => {
  const index = await c.env.ASSETS.fetch(new URL("/skills/index.json", c.req.url));
  return c.body(await index.text(), index.status === 200 ? 200 : 404, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/.well-known/api-catalog", (c) =>
  c.body(JSON.stringify(apiCatalog(new URL(c.req.url).origin)), 200, {
    "Content-Type": "application/linkset+json",
    "Cache-Control": "public, max-age=3600",
  }),
);

app.get("/s/:id", async (c) => {
  const asset = await c.env.ASSETS.fetch(new URL("/share.html", c.req.url));
  const html = fillPrivacyLink(
    (await asset.text()).replaceAll("{{origin}}", new URL(c.req.url).origin),
    configuredPrivacyUrl(c.env),
  );
  const response = new Response(html, asset);
  response.headers.set("Content-Type", "text/html; charset=utf-8");
  response.headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(SHARE_PAGE_HEADERS)) {
    response.headers.set(name, value);
  }
  if (new URL(c.req.url).protocol === "https:") {
    response.headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  }
  return response;
});

app.get("/turnstile", (c) => {
  const siteKey = turnstileSiteKey(c.env);
  if (!siteKey) {
    return c.notFound();
  }
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Response(turnstileFramePage(siteKey, nonce), {
    headers: turnstileFrameHeaders(nonce),
  });
});

for (const page of SITE_PAGES) {
  app.get(page, (c) => {
    if (c.env.SITE) {
      return serveFromSite(c, c.env.SITE);
    }
    return page in MARKDOWN_PAGES ? servePage(c) : c.notFound();
  });
}
for (const page of Object.keys(MARKDOWN_PAGES).filter((page) => !SITE_PAGES.includes(page))) {
  app.get(page, servePage);
}
app.get("/api-docs", servePage);

app.get("/.well-known/security.txt", (c) => {
  const url = new URL(c.req.url);
  const body = securityTxt(url.origin, c.env.SECURITY_CONTACT, Date.now());
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (url.protocol === "https:") {
    headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY;
  }
  return new Response(body, { headers });
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json(apiError("server.not_found"), 404)
    : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((error, c) => {
  if (error instanceof InvalidBodyError) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  logError("unhandled_error", error, { method: c.req.method, path: c.req.path });
  return c.json(apiError("server.error"), 500);
});

export { OrgStore } from "./orgs/org-object.js";
export { UserStore } from "./user-vault-object.js";

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?").bind(
        now,
        now - SESSION_IDLE_SECONDS,
      ),
      env.DB.prepare("DELETE FROM login_attempts WHERE window_start <= ?").bind(now - 86_400),
      env.DB.prepare("DELETE FROM registration_counts WHERE day < ?").bind(
        Math.floor(now / 86_400),
      ),
      env.DB.prepare("DELETE FROM email_verifications WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM recovery_email_codes WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM share_codes WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM auth_throttle WHERE updated_at <= ?").bind(
        now - PAIR_MEMORY_SECONDS,
      ),
      env.DB.prepare("DELETE FROM two_factor_challenges WHERE expires_at <= ?").bind(now),
    ]);
    const [shares, sessions, loginAttempts, registrationCounts, verifications, shareCodes] =
      results.map((result) => result.meta.changes);
    logInfo("cleanup", {
      shares,
      sessions,
      loginAttempts,
      registrationCounts,
      verifications,
      shareCodes,
    });
  },
} satisfies ExportedHandler<Env>;
