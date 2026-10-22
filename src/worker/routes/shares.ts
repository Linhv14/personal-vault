import { Hono } from "hono";
import type { Context } from "hono";
import { randomBytes, timingSafeEqual, toBase64Url, utf8Encode } from "../../core/bytes.js";
import { normalizeEmail } from "../email-address.js";
import { apiError } from "../errors.js";
import { inBackground, now, readJson } from "../http.js";
import { createMailer } from "../mailer.js";
import { isCode } from "../one-time-code.js";
import { hashToken } from "../session.js";
import { isBase64, isPlainObject } from "../validate.js";
import { consumeShareCode, MAX_RECIPIENTS, recipientHash, sendShareCode } from "../share-access.js";
import type { AppBindings } from "../types.js";

/**
 * Share links. The decryption key never reaches this code: it travels in the
 * URL fragment, which browsers do not send to the server.
 */
const shares = new Hono<AppBindings>();

const MAX_SHARE_BYTES = 16 * 1024;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_VIEWS_LIMIT = 100;
const MAX_STATUS_LOOKUPS = 50;
const UNLIMITED_VIEWS = 0;
const VIEWABLE = "(max_views = 0 OR view_count < max_views)";

function viewsLeft(row: { max_views: number; view_count: number }): number | null {
  return row.max_views === UNLIMITED_VIEWS ? null : row.max_views - row.view_count;
}

interface ClaimedShare {
  ciphertext: string;
  nonce: string;
  expires_at: number;
  max_views: number;
  view_count: number;
}

async function claimView(
  c: Context<AppBindings>,
  id: string,
  timestamp: number,
): Promise<Response> {
  const row = await c.env.DB.prepare(
    `UPDATE shares
        SET view_count = view_count + 1
      WHERE id = ? AND expires_at > ? AND ${VIEWABLE}
  RETURNING ciphertext, nonce, expires_at, max_views, view_count`,
  )
    .bind(id, timestamp)
    .first<ClaimedShare>();
  if (!row) {
    return c.json(apiError("shares.gone"), 404);
  }

  const remaining = viewsLeft(row);
  if (remaining === 0) {
    c.executionCtx.waitUntil(c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run());
  }

  c.header("Cache-Control", "no-store");
  return c.json({
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    expiresAt: row.expires_at,
    viewsLeft: remaining,
  });
}

function parseRecipients(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS) {
    return null;
  }
  const emails = value.map((entry: unknown) => normalizeEmail(entry));
  if (emails.some((email) => email === null)) {
    return null;
  }
  return [...new Set(emails.filter((email): email is string => email !== null))];
}

shares.post("/", async (c) => {
  const { ciphertext, nonce, ttlSeconds, maxViews, recipients } = await readJson(c);

  if (!isBase64(ciphertext, MAX_SHARE_BYTES) || !isBase64(nonce, 12)) {
    return c.json(apiError("shares.invalid_payload"), 400);
  }
  if (typeof ttlSeconds !== "number" || ttlSeconds < 60 || ttlSeconds > MAX_TTL_SECONDS) {
    return c.json(apiError("shares.invalid_ttl"), 400);
  }
  if (
    maxViews !== null &&
    (!Number.isInteger(maxViews) ||
      (maxViews as number) < 1 ||
      (maxViews as number) > MAX_VIEWS_LIMIT)
  ) {
    return c.json(apiError("shares.invalid_max_views"), 400);
  }
  const allowed = parseRecipients(recipients);
  if (!allowed) {
    return c.json(apiError("shares.invalid_recipients"), 400);
  }
  if (allowed.length > 0 && !createMailer(c.env)) {
    return c.json(apiError("shares.email_unavailable"), 400);
  }

  // Random id rather than a counter: guessable ids would let anyone enumerate
  // every share that currently exists.
  const id = toBase64Url(randomBytes(16));
  const revokeToken = toBase64Url(randomBytes(32));
  const timestamp = now();
  const expiresAt = timestamp + ttlSeconds;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO shares
         (id, ciphertext, nonce, expires_at, max_views, view_count, created_at, revoke_hash, restricted)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(
      id,
      ciphertext,
      nonce,
      expiresAt,
      maxViews ?? UNLIMITED_VIEWS,
      timestamp,
      await hashToken(revokeToken),
      allowed.length > 0 ? 1 : 0,
    ),
    ...(await Promise.all(
      allowed.map(async (email) =>
        c.env.DB.prepare("INSERT INTO share_recipients (share_id, email_hash) VALUES (?, ?)").bind(
          id,
          await recipientHash(c.env, email),
        ),
      ),
    )),
  ]);

  return c.json({ id, expiresAt, maxViews, revokeToken }, 201);
});

shares.post("/status", async (c) => {
  const { shares: list } = await readJson(c);
  const requested: unknown[] | null = Array.isArray(list) ? list : null;
  if (!requested || requested.length > MAX_STATUS_LOOKUPS) {
    return c.json(apiError("shares.invalid_payload"), 400);
  }

  const timestamp = now();
  const statuses = await Promise.all(
    requested.map(async (entry: unknown) => {
      const { id, revokeToken } = isPlainObject(entry) ? entry : {};
      if (typeof id !== "string" || typeof revokeToken !== "string") {
        return null;
      }
      const row = await c.env.DB.prepare(
        "SELECT revoke_hash, expires_at, max_views, view_count FROM shares WHERE id = ?",
      )
        .bind(id)
        .first<{
          revoke_hash: string | null;
          expires_at: number;
          max_views: number;
          view_count: number;
        }>();
      const owned =
        row?.revoke_hash &&
        timingSafeEqual(utf8Encode(await hashToken(revokeToken)), utf8Encode(row.revoke_hash));
      if (!row || !owned || row.expires_at <= timestamp || viewsLeft(row) === 0) {
        return { id, active: false };
      }
      return {
        id,
        active: true,
        expiresAt: row.expires_at,
        viewsLeft: viewsLeft(row),
      };
    }),
  );
  return c.json({ shares: statuses.filter(Boolean) });
});

shares.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const revokeToken = c.req.header("x-revoke-token") ?? "";
  const row = await c.env.DB.prepare("SELECT revoke_hash FROM shares WHERE id = ?")
    .bind(id)
    .first<{ revoke_hash: string | null }>();
  const owned =
    row?.revoke_hash &&
    timingSafeEqual(utf8Encode(await hashToken(revokeToken)), utf8Encode(row.revoke_hash));
  if (!owned) {
    return c.json(apiError("shares.gone"), 404);
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

shares.get("/:id", async (c) => {
  const id = c.req.param("id");
  const timestamp = now();

  const share = await c.env.DB.prepare(
    `SELECT restricted FROM shares WHERE id = ? AND expires_at > ? AND ${VIEWABLE}`,
  )
    .bind(id, timestamp)
    .first<{ restricted: number }>();
  if (!share) {
    return c.json(apiError("shares.gone"), 404);
  }
  if (share.restricted) {
    return c.json(apiError("shares.email_required"), 403);
  }

  return claimView(c, id, timestamp);
});

shares.post("/:id/code", async (c) => {
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!email) {
    return c.json(apiError("auth.invalid_email"), 400);
  }

  const mailer = createMailer(c.env);
  if (mailer) {
    const request = {
      shareId: c.req.param("id"),
      email,
      locale: body.locale === "vi" ? ("vi" as const) : ("en" as const),
      siteUrl: new URL(c.req.url).origin,
    };
    const timestamp = now();
    inBackground(c, "share_access_email_failed", () =>
      sendShareCode(c.env, mailer, request, timestamp),
    );
  }
  return c.json({ ok: true });
});

shares.post("/:id/open", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c);
  const email = normalizeEmail(body.email);
  if (!email || !isCode(body.code)) {
    return c.json(apiError("shares.invalid_code"), 400);
  }

  const timestamp = now();
  const result = await consumeShareCode(c.env, id, email, body.code, timestamp);
  if (result === "invalid") {
    return c.json(apiError("shares.invalid_code"), 400);
  }
  if (result === "expired") {
    return c.json(apiError("shares.code_expired"), 400);
  }
  return claimView(c, id, timestamp);
});

export default shares;
