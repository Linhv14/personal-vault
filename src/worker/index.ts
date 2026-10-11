import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { apiError } from "./errors.js";
import auth from "./routes/auth.js";
import items from "./routes/items.js";
import shares from "./routes/shares.js";
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

const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const session = await resolveSession(c.env, c.req.header("Authorization"));
  if (!session) return c.json(apiError("auth.unauthorized"), 401);
  c.set("session", session);
  await next();
};

app.use("/api/items", requireAuth);
app.use("/api/items/*", requireAuth);
app.use("/api/auth/logout", requireAuth);
app.use("/api/auth/change-password", requireAuth);

// Creating a share needs a session; reading one must not, since the recipient
// has no account.
app.use("/api/shares", async (c, next) =>
  c.req.method === "POST" ? requireAuth(c, next) : next(),
);

app.route("/api/auth", auth);
app.route("/api/items", items);
app.route("/api/shares", shares);

/**
 * Lets the extension measure clock drift at unlock. A machine whose clock is off
 * produces 2FA codes that look perfectly normal while every site rejects them —
 * close to undiagnosable without this.
 */
app.get("/api/time", (c) => c.json({ serverTime: Math.floor(Date.now() / 1000) }));

app.get("/s/:id", async (c) => {
  const response = await c.env.ASSETS.fetch(new URL("/share.html", c.req.url));
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
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

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM login_attempts WHERE window_start <= ?").bind(now - 86_400),
    ]);
    console.log(
      "Cleaned up shares/sessions/login_attempts:",
      results.map((r) => r.meta.changes).join("/"),
    );
  },
} satisfies ExportedHandler<Env>;
