import { Hono } from "hono";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { userStore } from "../durable-objects.js";
import type { AppBindings } from "../types.js";
import { isSealed, isUuid } from "../validate.js";

const items = new Hono<AppBindings>();

const MAX_ITEM_BYTES = 64 * 1024;
const MAX_BATCH_ITEMS = 100;

interface SealedRow {
  id: string;
  ciphertext: string;
  nonce: string;
}

function isSealedItem(value: unknown): value is { ciphertext: string; nonce: string } {
  return isSealed(value, MAX_ITEM_BYTES);
}

items.get("/", async (c) => {
  const since = Number.parseInt(c.req.query("since") ?? "0", 10);
  const { accountId } = c.get("session");
  return respond(
    c,
    await userStore(c.env, accountId).list(
      accountId,
      Number.isFinite(since) && since > 0 ? since : 0,
    ),
  );
});

items.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json(apiError("items.invalid_id"), 400);
  }
  const body = await readJson(c);
  if (!isSealedItem(body)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }

  const condition = c.req.query("ifUpdatedAt");
  const ifUpdatedAt = condition === undefined ? undefined : Number(condition);
  if (ifUpdatedAt !== undefined && !Number.isSafeInteger(ifUpdatedAt)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }
  const { accountId } = c.get("session");
  const sealed = { ciphertext: body.ciphertext, nonce: body.nonce };
  return respond(c, await userStore(c.env, accountId).put(accountId, id, sealed, ifUpdatedAt));
});

items.post("/batch", async (c) => {
  const { items: batch } = await readJson(c);
  if (!Array.isArray(batch) || batch.length === 0 || batch.length > MAX_BATCH_ITEMS) {
    return c.json(apiError("items.invalid_payload"), 400);
  }
  const rows = batch as Partial<SealedRow>[];
  if (rows.some((row) => !isUuid(row?.id))) {
    return c.json(apiError("items.invalid_id"), 400);
  }
  if (!rows.every(isSealedItem)) {
    return c.json(apiError("items.invalid_payload"), 400);
  }

  const { accountId } = c.get("session");
  const sealed = (rows as SealedRow[]).map(({ id, ciphertext, nonce }) => ({
    id,
    ciphertext,
    nonce,
  }));
  return respond(c, await userStore(c.env, accountId).createMany(accountId, sealed));
});

items.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json(apiError("items.invalid_id"), 400);
  }
  const { accountId } = c.get("session");
  return respond(c, await userStore(c.env, accountId).remove(accountId, id));
});

export default items;
