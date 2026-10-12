import { Hono } from "hono";
import { toBase64Url, randomBytes } from "../../core/bytes.js";
import { apiError } from "../errors.js";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";

/**
 * Share links. The decryption key never reaches this code: it travels in the
 * URL fragment, which browsers do not send to the server.
 */
const shares = new Hono<AppBindings>();

const MAX_SHARE_BYTES = 16 * 1024;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_VIEWS_LIMIT = 100;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

shares.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const { ciphertext, nonce, ttlSeconds, maxViews } = (body ?? {}) as Record<string, unknown>;

  if (!isBase64(ciphertext, MAX_SHARE_BYTES) || !isBase64(nonce, 12)) {
    return c.json(apiError("shares.invalid_payload"), 400);
  }
  if (typeof ttlSeconds !== "number" || ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS) {
    return c.json(apiError("shares.invalid_ttl"), 400);
  }
  if (
    !Number.isInteger(maxViews) ||
    (maxViews as number) < 1 ||
    (maxViews as number) > MAX_VIEWS_LIMIT
  ) {
    return c.json(apiError("shares.invalid_max_views"), 400);
  }

  // Random id rather than a counter: guessable ids would let anyone enumerate
  // every share that currently exists.
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

shares.get("/:id", async (c) => {
  const id = c.req.param("id");
  const timestamp = now();

  // Claim the view with a single conditional UPDATE. Reading first and writing
  // after would let two people open a `max_views = 1` link simultaneously.
  const row = await c.env.DB.prepare(
    `UPDATE shares
        SET view_count = view_count + 1
      WHERE id = ? AND expires_at > ? AND view_count < max_views
  RETURNING ciphertext, nonce, expires_at, max_views, view_count`,
  )
    .bind(id, timestamp)
    .first<{
      ciphertext: string;
      nonce: string;
      expires_at: number;
      max_views: number;
      view_count: number;
    }>();

  if (!row) return c.json(apiError("shares.gone"), 404);

  const viewsLeft = row.max_views - row.view_count;

  if (viewsLeft <= 0) {
    c.executionCtx.waitUntil(c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run());
  }

  c.header("Cache-Control", "no-store");
  return c.json({
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    expiresAt: row.expires_at,
    viewsLeft,
  });
});

export default shares;
