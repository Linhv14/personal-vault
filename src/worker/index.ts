import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { apiError } from "./errors.js";
import account from "./routes/account.js";
import auth from "./routes/auth.js";
import items from "./routes/items.js";
import logos from "./routes/logos.js";
import shares from "./routes/shares.js";
import { emailVerificationEnabled } from "./email-verification.js";
import { clientIp, isOpenRegistration } from "./request.js";
import { resolveSession } from "./session.js";
import type { AppBindings, Env } from "./types.js";

const app = new Hono<AppBindings>();

app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")
        ? origin
        : null,
    allowHeaders: ["Content-Type", "Authorization", "X-Registration-Token"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86_400,
  }),
);

const limitByClientIp: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { success } = await c.env.ANONYMOUS_RATE_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json(apiError("server.rate_limited"), 429);
  await next();
};

const limitRegistrationsByIp: MiddlewareHandler<AppBindings> = async (c, next) => {
  const { success } = await c.env.REGISTRATION_RATE_LIMITER.limit({ key: clientIp(c) });
  if (!success) return c.json(apiError("server.rate_limited"), 429);
  await next();
};

app.use("/api/auth/register", limitRegistrationsByIp);
app.use("/api/auth/verify-email", limitRegistrationsByIp);
app.use("/api/auth/verify-email", limitByClientIp);

app.use("/api/auth/register", limitByClientIp);
app.use("/api/auth/prelogin", limitByClientIp);
app.use("/api/auth/login", limitByClientIp);
app.on("GET", "/api/shares/*", limitByClientIp);
app.on("POST", ["/api/shares/:id/code", "/api/shares/:id/open"], limitByClientIp);

const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = await resolveSession(c.env, c.req.header("Authorization"));
  if (!session) return c.json(apiError("auth.unauthorized"), 401);
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
app.use("/api/account/*", requireAuth);
app.use("/api/auth/delete-account", requireAuth);

// Creating a share needs a session; reading one must not, since the recipient
// has no account.
app.use("/api/shares", async (c, next) =>
  c.req.method === "POST" ? requireAuth(c, next) : next(),
);

const limitWritesByAccount: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method === "GET") return next();
  const { success } = await c.env.ACCOUNT_RATE_LIMITER.limit({
    key: c.get("session").accountId,
  });
  if (!success) return c.json(apiError("server.rate_limited"), 429);
  await next();
};

app.use("/api/items/*", limitWritesByAccount);
app.use("/api/shares", async (c, next) =>
  c.req.method === "POST" ? limitWritesByAccount(c, next) : next(),
);
app.use("/api/shares/status", requireAuth);
app.on("DELETE", "/api/shares/*", requireAuth);
app.on("DELETE", "/api/shares/*", limitWritesByAccount);

app.get("/api/config", (c) =>
  c.json({
    registration: isOpenRegistration(c.env) ? "open" : "token",
    emailVerification: emailVerificationEnabled(c.env),
  }),
);

app.route("/api/auth", auth);
app.route("/api/account", account);
app.route("/api/items", items);
app.route("/api/logo", logos);
app.route("/api/shares", shares);

/**
 * Lets the extension measure clock drift at unlock. A machine whose clock is off
 * produces 2FA codes that look perfectly normal while every site rejects them —
 * close to undiagnosable without this.
 */
app.get("/api/time", (c) => c.json({ serverTime: Math.floor(Date.now() / 1000) }));

app.get("/s/:id", async (c) => {
  const asset = await c.env.ASSETS.fetch(new URL("/share.html", c.req.url));
  const response = new Response(asset.body, asset);
  response.headers.set("Content-Type", "text/html; charset=utf-8");
  response.headers.set("Cache-Control", "no-store");
  return response;
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json(apiError("server.not_found"), 404)
    : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((error, c) => {
  // Never echo the cause: a D1 message can contain the SQL statement.
  console.error("Unhandled error:", error);
  return c.json(apiError("server.error"), 500);
});

export { UserStore } from "./user-store.js";

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM login_attempts WHERE window_start <= ?").bind(now - 86_400),
      env.DB.prepare("DELETE FROM registration_counts WHERE day < ?").bind(
        Math.floor(now / 86_400),
      ),
      env.DB.prepare("DELETE FROM email_verifications WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM share_codes WHERE expires_at <= ?").bind(now),
    ]);
    console.log(
      "Cleaned up shares/sessions/login_attempts/registration_counts/email_verifications/share_codes:",
      results.map((r) => r.meta.changes).join("/"),
    );
  },
} satisfies ExportedHandler<Env>;
