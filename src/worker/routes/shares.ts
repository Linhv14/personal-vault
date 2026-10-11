import { Hono } from "hono";
import { toBase64Url, randomBytes } from "../../core/bytes.js";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";

/**
 * Link share.
 *
 * Khoá giải mã KHÔNG đi qua đây. Nó nằm trong fragment của URL (`#...`), phần mà
 * browser không gửi lên server. Worker chỉ giữ ciphertext và đếm số lần xem.
 */
const shares = new Hono<AppBindings>();

const MAX_SHARE_BYTES = 16 * 1024;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_VIEWS_LIMIT = 100;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Tạo link share. Cần đăng nhập — không ai dùng Worker của bạn làm pastebin. */
export const createShare = shares.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { ciphertext, nonce, ttlSeconds, maxViews } = (body ?? {}) as Record<string, unknown>;

  if (!isBase64(ciphertext, MAX_SHARE_BYTES) || !isBase64(nonce, 12)) {
    return c.json({ error: "ciphertext hoặc nonce không hợp lệ" }, 400);
  }
  if (typeof ttlSeconds !== "number" || ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS) {
    return c.json({ error: "ttlSeconds phải từ 60 đến 604800" }, 400);
  }
  if (!Number.isInteger(maxViews) || (maxViews as number) < 1 || (maxViews as number) > MAX_VIEWS_LIMIT) {
    return c.json({ error: `maxViews phải từ 1 đến ${MAX_VIEWS_LIMIT}` }, 400);
  }

  // 16 byte ngẫu nhiên cho id. Không dùng số tăng dần: id đoán được thì ai cũng
  // liệt kê được mọi link share đang tồn tại.
  const id = toBase64Url(randomBytes(16));
  const timestamp = now();
  const expiresAt = timestamp + ttlSeconds;

  await c.env.DB.prepare(
    `INSERT INTO shares (id, ciphertext, nonce, expires_at, max_views, view_count, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(id, ciphertext, nonce, expiresAt, maxViews, timestamp)
    .run();

  return c.json({ id, expiresAt, maxViews }, 201);
});

/**
 * Đọc link share. Public — người nhận không có account.
 *
 * Tăng `view_count` bằng một câu UPDATE có điều kiện rồi mới đọc nội dung: nếu
 * làm ngược lại (đọc, kiểm tra, rồi ghi) thì hai người mở link cùng lúc đều xem
 * được dù `max_views = 1`.
 */
shares.get("/:id", async (c) => {
  const id = c.req.param("id");
  const timestamp = now();

  const claimed = await c.env.DB.prepare(
    `UPDATE shares
        SET view_count = view_count + 1
      WHERE id = ? AND expires_at > ? AND view_count < max_views`,
  )
    .bind(id, timestamp)
    .run();

  if (!claimed.meta.changes) {
    // Gộp mọi lý do (không tồn tại / hết hạn / hết lượt xem) vào một phản hồi để
    // không tiết lộ id nào từng tồn tại.
    return c.json({ error: "Link không tồn tại, đã hết hạn hoặc đã dùng hết lượt xem" }, 404);
  }

  const row = await c.env.DB.prepare(
    "SELECT ciphertext, nonce, expires_at, max_views, view_count FROM shares WHERE id = ?",
  )
    .bind(id)
    .first<{
      ciphertext: string;
      nonce: string;
      expires_at: number;
      max_views: number;
      view_count: number;
    }>();

  if (!row) return c.json({ error: "Link không tồn tại" }, 404);

  const viewsLeft = row.max_views - row.view_count;
  const payload = {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    expiresAt: row.expires_at,
    viewsLeft,
  };

  // Hết lượt xem thì xoá luôn ciphertext khỏi D1, không chờ cron.
  if (viewsLeft <= 0) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run(),
    );
  }

  // Không cho cache: phản hồi này chỉ hợp lệ đúng một lần.
  c.header("Cache-Control", "no-store");
  return c.json(payload);
});

export default shares;
