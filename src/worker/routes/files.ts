import { Hono } from "hono";
import { apiError } from "../errors.js";
import { respond } from "../http.js";
import { userStore } from "../durable-objects.js";
import { attachmentsMode, fileLimits, mayAttach, personalFileKey } from "../files.js";
import type { AppBindings } from "../types.js";
import { isUuid } from "../validate.js";

const files = new Hono<AppBindings>();

files.put("/:id", async (c) => {
  const id = c.req.param("id");
  const itemId = c.req.query("item");
  const size = Number(c.req.header("Content-Length"));
  const bucket = c.env.FILES;
  if (!bucket || attachmentsMode(c.env) === "off") {
    return c.json(apiError("files.unavailable"), 404);
  }
  if (
    !isUuid(id) ||
    !isUuid(itemId) ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !c.req.raw.body
  ) {
    return c.json(apiError("files.invalid"), 400);
  }
  const { accountId } = c.get("session");
  if (!(await mayAttach(c.env, accountId))) {
    return c.json(apiError("files.plan_required"), 403);
  }
  const limits = fileLimits(c.env);
  if (size > limits.sealedMax) {
    return c.json(apiError("files.too_large", { limit: limits.sealedMax }), 413);
  }
  const store = userStore(c.env, accountId);
  const reserved = await store.reserveFile(accountId, { id, itemId, size }, limits);
  if (!reserved.ok) {
    return respond(c, reserved);
  }
  const key = personalFileKey(accountId, id);
  try {
    const stored = await bucket.put(key, c.req.raw.body);
    if (stored?.size !== size) {
      await store.removeFile(accountId, id);
      return c.json(apiError("files.invalid"), 400);
    }
  } catch (error) {
    await store.removeFile(accountId, id);
    throw error;
  }
  return c.json({ id, size }, 201);
});

files.get("/:id", async (c) => {
  const id = c.req.param("id");
  const bucket = c.env.FILES;
  if (!bucket) {
    return c.json(apiError("files.unavailable"), 404);
  }
  if (!isUuid(id)) {
    return c.json(apiError("files.invalid"), 400);
  }
  const { accountId } = c.get("session");
  const size = await userStore(c.env, accountId).fileSize(accountId, id);
  const object = size === null ? null : await bucket.get(personalFileKey(accountId, id));
  if (!object) {
    return c.json(apiError("files.not_found"), 404);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
    },
  });
});

files.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) {
    return c.json(apiError("files.invalid"), 400);
  }
  const { accountId } = c.get("session");
  return respond(c, await userStore(c.env, accountId).removeFile(accountId, id));
});

export default files;
