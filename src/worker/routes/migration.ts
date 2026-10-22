import { Hono } from "hono";
import { utf8Encode } from "../../core/bytes.js";
import { apiError } from "../errors.js";
import { readJson } from "../http.js";
import { isPlainObject } from "../../core/json.js";
import { isStoreDump, type StoreDump } from "../migration.js";
import { orgStore, userStore } from "../stores.js";
import type { AppBindings } from "../types.js";

interface Snapshot {
  users: Record<string, StoreDump>;
  orgs: Record<string, StoreDump>;
}

function isDumps(value: unknown): value is Record<string, StoreDump> {
  return isPlainObject(value) && Object.values(value).every(isStoreDump);
}

const migration = new Hono<AppBindings>();

migration.use("*", async (c, next) => {
  const expected = c.env.MIGRATION_TOKEN;
  const provided = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!expected) {
    return c.json(apiError("server.not_found"), 404);
  }
  const [a, b] = await Promise.all(
    [provided, expected].map((value) => crypto.subtle.digest("SHA-256", utf8Encode(value))),
  );
  if (!crypto.subtle.timingSafeEqual(a!, b!)) {
    return c.json(apiError("auth.unauthorized"), 401);
  }
  await next();
});

migration.get("/export", async (c) => {
  const ids = async (table: "accounts" | "orgs") =>
    (await c.env.DB.prepare(`SELECT id FROM ${table}`).all<{ id: string }>()).results.map(
      (row) => row.id,
    );
  const snapshot: Snapshot = { users: {}, orgs: {} };
  for (const id of await ids("accounts")) {
    snapshot.users[id] = await userStore(c.env, id).exportState();
  }
  for (const id of await ids("orgs")) {
    snapshot.orgs[id] = await orgStore(c.env, id).exportState();
  }
  return c.json(snapshot);
});

migration.post("/import", async (c) => {
  const { users, orgs } = await readJson(c);
  if (!isDumps(users) || !isDumps(orgs)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  const snapshot: Snapshot = { users, orgs };
  let rows = 0;
  try {
    for (const [id, dump] of Object.entries(snapshot.users)) {
      rows += await userStore(c.env, id).importState(dump);
    }
    for (const [id, dump] of Object.entries(snapshot.orgs)) {
      rows += await orgStore(c.env, id).importState(dump);
    }
  } catch (error) {
    return c.json({ ...apiError("server.import_conflict"), detail: String(error) }, 409);
  }
  return c.json({
    users: Object.keys(snapshot.users).length,
    orgs: Object.keys(snapshot.orgs).length,
    rows,
  });
});

export default migration;
