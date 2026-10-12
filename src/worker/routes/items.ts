import { Hono } from "hono";
import { apiError } from "../errors.js";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";

const items = new Hono<AppBindings>();

const MAX_ITEM_BYTES = 64 * 1024;
const UPDATED_AT_RESOLUTION_SECONDS = 1;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

items.get("/", async (c) => {
  const since = Number.parseInt(c.req.query("since") ?? "0", 10);
  const serverTime = now();

  const { results } = await c.env.DB.prepare(
    `SELECT id, ciphertext, nonce, updated_at, deleted_at
       FROM items
      WHERE account_id = ? AND updated_at > ?
      ORDER BY updated_at ASC`,
  )
    .bind(c.get("session").accountId, Number.isFinite(since) && since > 0 ? since : 0)
    .all<{
      id: string;
      ciphertext: string;
      nonce: string;
      updated_at: number;
      deleted_at: number | null;
    }>();

  return c.json({
    // Clients use this as the `since` cursor for their next call. It has to be
    // the server clock: if each device used its own, a device running a few
    // seconds fast would skip exactly the items it just changed.
    serverTime: serverTime - UPDATED_AT_RESOLUTION_SECONDS,
    items: results.map((row) => ({
      id: row.id,
      ciphertext: row.deleted_at ? null : row.ciphertext,
      nonce: row.deleted_at ? null : row.nonce,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
  });
});

items.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json(apiError("items.invalid_id"), 400);

  const body = await c.req.json().catch(() => null);
  const { ciphertext, nonce } = (body ?? {}) as Record<string, unknown>;
  if (!isBase64(ciphertext, MAX_ITEM_BYTES) || !isBase64(nonce, 12)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }

  const { accountId } = c.get("session");
  const updatedAt = now();

  const result = await c.env.DB.prepare(
    `INSERT INTO items (id, account_id, ciphertext, nonce, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE
       SET ciphertext = excluded.ciphertext,
           nonce = excluded.nonce,
           updated_at = excluded.updated_at,
           deleted_at = NULL
     WHERE items.account_id = ?`,
    // The WHERE on the UPDATE branch is load-bearing: without it, anyone who
    // learns another account's item id can overwrite it.
  )
    .bind(id, accountId, ciphertext, nonce, updatedAt, accountId)
    .run();

  if (!result.meta.changes) return c.json(apiError("items.forbidden"), 403);
  return c.json({ id, updatedAt });
});

items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json(apiError("items.invalid_id"), 400);

  const deletedAt = now();
  // Soft delete. A real DELETE would let an offline device resurrect the item on
  // its next sync, because it would never learn the item was removed.
  const result = await c.env.DB.prepare(
    `UPDATE items
        SET deleted_at = ?, updated_at = ?, ciphertext = '', nonce = ''
      WHERE id = ? AND account_id = ? AND deleted_at IS NULL`,
  )
    .bind(deletedAt, deletedAt, id, c.get("session").accountId)
    .run();

  if (!result.meta.changes) return c.json(apiError("items.not_found"), 404);
  return c.json({ id, deletedAt });
});

export default items;
