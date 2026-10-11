import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import auth from "./routes/auth.js";
import items from "./routes/items.js";
import shares from "./routes/shares.js";
import { resolveSession } from "./session.js";
import type { AppBindings, Env } from "./types.js";

const app = new Hono<AppBindings>();

/**
 * Xác thực bằng Bearer token, không dùng cookie.
 *
 * Vì không có cookie, không có CSRF: một trang web độc hại không thể bắt browser
 * tự gắn token của bạn vào request của nó. Đổi lại, CORS ở đây chỉ cần mở đủ cho
 * popup extension gọi API.
 */
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
  if (!session) return c.json({ error: "Chưa đăng nhập hoặc session đã hết hạn" }, 401);
  c.set("session", session);
  await next();
};

app.use("/api/items", requireAuth);
app.use("/api/items/*", requireAuth);
app.use("/api/auth/logout", requireAuth);
app.use("/api/auth/change-password", requireAuth);

// Tạo link share cần đăng nhập, nhưng đọc link thì không — người nhận không có
// account, đó là toàn bộ mục đích của tính năng này.
app.use("/api/shares", async (c, next) =>
  c.req.method === "POST" ? requireAuth(c, next) : next(),
);

app.route("/api/auth", auth);
app.route("/api/items", items);
app.route("/api/shares", shares);

/**
 * Extension gọi endpoint này lúc unlock để đo lệch đồng hồ.
 *
 * TOTP sai nếu đồng hồ máy lệch quá nửa chu kỳ, và đó là lỗi gần như không thể
 * tự chẩn đoán: mã hiện ra trông bình thường, site chỉ báo "code không đúng".
 */
app.get("/api/time", (c) => c.json({ serverTime: Math.floor(Date.now() / 1000) }));

/**
 * Trang xem link share. Mọi `/s/<id>` trả về cùng một file HTML; chính trang đó
 * đọc id từ đường dẫn và khoá từ fragment rồi tự giải mã.
 */
app.get("/s/:id", async (c) => {
  const response = await c.env.ASSETS.fetch(new URL("/share.html", c.req.url));
  // Trang này chứa logic giải mã, không chứa secret — nhưng vẫn đặt no-store để
  // một bản cũ nằm trong cache không che mất bản đã sửa lỗi.
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json({ error: "Không có endpoint này" }, 404)
    : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((error, c) => {
  // Không trả chi tiết lỗi ra ngoài: thông báo của D1 có thể chứa cả câu SQL.
  console.error("Lỗi không xử lý:", error);
  return c.json({ error: "Lỗi server" }, 500);
});

export default {
  fetch: app.fetch,

  /**
   * Cron mỗi giờ: dọn link share và session đã hết hạn.
   *
   * Ciphertext hết hạn vẫn không ai giải mã được, nhưng giữ dữ liệu lâu hơn mức
   * cần thiết là rủi ro không có lý do.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("DELETE FROM login_attempts WHERE window_start <= ?").bind(now - 86_400),
    ]);
    console.log(
      "Đã dọn:",
      results.map((r) => r.meta.changes).join("/"),
      "(shares/sessions/login_attempts)",
    );
  },
} satisfies ExportedHandler<Env>;
