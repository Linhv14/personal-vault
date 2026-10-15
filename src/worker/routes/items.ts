import { Hono, type Context } from "hono";
import { apiError, type ApiErrorCode } from "../errors.js";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";
import type { StoreResult } from "../user-store.js";

const items = new Hono<AppBindings>();

const MAX_ITEM_BYTES = 64 * 1024;
const MAX_BATCH_ITEMS = 100;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function store(c: Context<AppBindings>) {
  const { USER_STORE } = c.env;
  return USER_STORE.get(USER_STORE.idFromName(`user:${c.get("session").accountId}`));
}

function respond<T>(c: Context<AppBindings>, result: StoreResult<T>) {
  return result.ok
    ? c.json(result.value as object)
    : c.json(apiError(result.code as ApiErrorCode), result.status);
}

items.get("/", async (c) => {
  const since = Number.parseInt(c.req.query("since") ?? "0", 10);
  return respond(
    c,
    await store(c).list(
      c.get("session").accountId,
      Number.isFinite(since) && since > 0 ? since : 0,
    ),
  );
});

items.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json(apiError("items.invalid_id"), 400);

  const body = await c.req.json().catch(() => null);
  const { ciphertext, nonce } = (body ?? {}) as Record<string, unknown>;
  if (!isBase64(ciphertext, MAX_ITEM_BYTES) || !isBase64(nonce, 12)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }

  const condition = c.req.query("ifUpdatedAt");
  const ifUpdatedAt = condition === undefined ? undefined : Number(condition);
  if (ifUpdatedAt !== undefined && !Number.isSafeInteger(ifUpdatedAt)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }
  return respond(
    c,
    await store(c).put(c.get("session").accountId, id, { ciphertext, nonce }, ifUpdatedAt),
  );
});

items.post("/batch", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
  const batch = Array.isArray(body?.items) ? body.items : null;
  if (!batch || batch.length === 0 || batch.length > MAX_BATCH_ITEMS) {
    return c.json(apiError("items.invalid_payload"), 400);
  }
  const rows = batch.map((entry: unknown) => (entry ?? {}) as Record<string, unknown>);
  if (rows.some(({ id }) => typeof id !== "string" || !isUuid(id))) {
    return c.json(apiError("items.invalid_id"), 400);
  }
  if (
    rows.some(
      ({ ciphertext, nonce }) => !isBase64(ciphertext, MAX_ITEM_BYTES) || !isBase64(nonce, 12),
    )
  ) {
    return c.json(apiError("items.invalid_payload"), 400);
  }
  return respond(
    c,
    await store(c).createMany(
      c.get("session").accountId,
      rows.map(({ id, ciphertext, nonce }) => ({
        id: id as string,
        ciphertext: ciphertext as string,
        nonce: nonce as string,
      })),
    ),
  );
});

items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json(apiError("items.invalid_id"), 400);
  return respond(c, await store(c).remove(c.get("session").accountId, id));
});

export default items;
