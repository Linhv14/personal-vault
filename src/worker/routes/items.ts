import { Hono } from "hono";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";

const items = new Hono<AppBindings>();

/** 64KB cho mỗi item — thoải mái cho ghi chú dài, nhưng không thành chỗ lưu file. */
const MAX_ITEM_BYTES = 64 * 1024;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Sync delta: chỉ trả item đã thay đổi sau `since`.
 *
 * `serverTime` trong phản hồi là mốc cho lần hỏi sau. Dùng đồng hồ server làm
 * nguồn duy nhất, vì nếu mỗi thiết bị dùng đồng hồ riêng thì một máy chạy chậm
 * vài giây sẽ bỏ sót đúng những item vừa sửa.
 */
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
    serverTime,
    items: results.map((row) => ({
      id: row.id,
      // Item đã xoá chỉ trả tombstone, không trả ciphertext — thiết bị nhận
      // tombstone thì xoá bản cục bộ, không cần nội dung nữa.
      ciphertext: row.deleted_at ? null : row.ciphertext,
      nonce: row.deleted_at ? null : row.nonce,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    })),
  });
});

/**
 * Upsert một item. Client tự sinh id (UUID) nên tạo mới và sửa dùng chung một
 * đường — nhờ đó retry sau khi mất mạng không tạo ra bản trùng.
 */
items.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "id phải là UUID" }, 400);

  const body = await c.req.json().catch(() => null);
  const { ciphertext, nonce } = (body ?? {}) as Record<string, unknown>;
  if (!isBase64(ciphertext, MAX_ITEM_BYTES) || !isBase64(nonce, 12)) {
    return c.json({ error: "ciphertext hoặc nonce không hợp lệ" }, 400);
  }

  const { accountId } = c.get("session");
  const updatedAt = now();

  // `WHERE account_id = ?` trong nhánh UPDATE là chốt chặn quan trọng: nếu thiếu,
  // ai biết id item của người khác đều ghi đè được lên nó.
  const result = await c.env.DB.prepare(
    `INSERT INTO items (id, account_id, ciphertext, nonce, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE
       SET ciphertext = excluded.ciphertext,
           nonce = excluded.nonce,
           updated_at = excluded.updated_at,
           deleted_at = NULL
     WHERE items.account_id = ?`,
  )
    .bind(id, accountId, ciphertext, nonce, updatedAt, accountId)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Không có quyền với item này" }, 403);
  }
  return c.json({ id, updatedAt });
});

/**
 * Xoá mềm. Giữ lại dòng với `deleted_at` để thiết bị đang offline biết item đã
 * bị xoá; nếu DELETE thật, lần sync sau nó sẽ đẩy item đó trở lại.
 */
items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "id phải là UUID" }, 400);

  const deletedAt = now();
  const result = await c.env.DB.prepare(
    `UPDATE items
        SET deleted_at = ?, updated_at = ?, ciphertext = '', nonce = ''
      WHERE id = ? AND account_id = ? AND deleted_at IS NULL`,
  )
    .bind(deletedAt, deletedAt, id, c.get("session").accountId)
    .run();

  if (!result.meta.changes) return c.json({ error: "Không tìm thấy item" }, 404);
  return c.json({ id, deletedAt });
});

export default items;
