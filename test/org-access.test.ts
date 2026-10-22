import { Hono, type Context } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { HARD_LIMITS, type Principal } from "../src/core/org-model.js";
import { readJsonObject } from "./helpers.js";
import { createD1, T0 } from "./worker-harness.js";

interface Env {
  DB: ReturnType<typeof createD1>["binding"];
}
type AppBindings = {
  Bindings: Env;
  Variables: { session: { accountId: string; tokenHash: string } };
};
type Ctx = Context<AppBindings>;
type Handler = (c: Ctx, member: Principal, orgId: string) => Promise<Response>;

const ORG_ACCESS: string = new URL("../src/worker/routes/org-access.ts", import.meta.url).href;
const { admins, asMember, isGeneration, limitsOf } = (await import(ORG_ACCESS)) as {
  admins(member: Principal): boolean;
  asMember(handler: Handler, rule?: (member: Principal) => boolean): (c: Ctx) => Promise<Response>;
  isGeneration(value: unknown): value is number;
  limitsOf(c: Ctx, orgId: string): Promise<{ seats: number; teams: number; projects: number }>;
};

let d1: ReturnType<typeof createD1>;
let env: Env;
let app: Hono<AppBindings>;
let calls: { member: Principal; orgId: string }[];

const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const ADMIN = crypto.randomUUID();
const MEMBER = crypto.randomUUID();
const OUTSIDER = crypto.randomUUID();

function addAccount(id: string) {
  d1.db
    .prepare(
      `INSERT INTO accounts (id, email, kdf_type, kdf_iterations, kdf_salt, auth_key_hash,
         wrapped_vault_key, wrap_nonce, created_at) VALUES (?, ?, 'pbkdf2-sha256', 600000, 's', 'h', 'w', 'n', ?)`,
    )
    .run(id, `${id}@example.com`, T0);
}

function addOrg(id: string, plan: string, members: [string, string][]) {
  d1.db
    .prepare("INSERT INTO orgs (id, name, plan, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, "Org", plan, members[0]?.[0] ?? OWNER, T0);
  for (const [accountId, role] of members) {
    d1.db
      .prepare("INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .run(id, accountId, role, T0);
  }
}

beforeEach(() => {
  d1 = createD1();
  env = { DB: d1.binding };
  for (const id of [OWNER, ADMIN, MEMBER, OUTSIDER]) {
    addAccount(id);
  }
  addOrg(ORG, "free", [
    [OWNER, "owner"],
    [ADMIN, "admin"],
    [MEMBER, "member"],
  ]);
  addOrg(OTHER_ORG, "free", [[OUTSIDER, "owner"]]);
  calls = [];
  app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("session", { accountId: c.req.header("x-account") ?? "", tokenHash: "t" });
    await next();
  });
  const record: Handler = async (c, member, orgId) => {
    calls.push({ member, orgId });
    return c.json({ ok: true });
  };
  app.get("/orgs/:orgId", asMember(record));
  app.get("/orgs/:orgId/admin", asMember(record, admins));
  app.get("/orgs/:orgId/limits", async (c) => c.json(await limitsOf(c, c.req.param("orgId"))));
});

const as = (accountId: string, path: string) =>
  app.request(path, { headers: { "x-account": accountId } }, env);

describe("asMember", () => {
  it("lets each member through with their own role", async () => {
    for (const [id, role] of [
      [OWNER, "owner"],
      [ADMIN, "admin"],
      [MEMBER, "member"],
    ] as const) {
      expect((await as(id, `/orgs/${ORG}`)).status).toBe(200);
      expect(calls.at(-1)).toEqual({ member: { accountId: id, role }, orgId: ORG });
    }
  });

  it("answers not found to outsiders, as if the org did not exist", async () => {
    const outsider = await as(OUTSIDER, `/orgs/${ORG}`);
    const missing = await as(OUTSIDER, `/orgs/${crypto.randomUUID()}`);
    expect(outsider.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await readJsonObject(outsider)).toEqual(await readJsonObject(missing));
    expect(calls).toHaveLength(0);
  });

  it("does not let a member of one org into another", async () => {
    expect((await as(OWNER, `/orgs/${OTHER_ORG}`)).status).toBe(404);
    expect((await as(OUTSIDER, `/orgs/${OTHER_ORG}`)).status).toBe(200);
  });

  it("forbids plain members from admin-only handlers", async () => {
    expect((await as(MEMBER, `/orgs/${ORG}/admin`)).status).toBe(403);
    expect((await as(ADMIN, `/orgs/${ORG}/admin`)).status).toBe(200);
    expect((await as(OWNER, `/orgs/${ORG}/admin`)).status).toBe(200);
    expect(calls.map((call) => call.member.accountId)).toEqual([ADMIN, OWNER]);
  });

  it("answers not found to outsiders on admin handlers, not forbidden", async () => {
    expect((await as(OUTSIDER, `/orgs/${ORG}/admin`)).status).toBe(404);
  });

  it("rejects ids that are not UUIDs before touching the database", async () => {
    const before = d1.log.length;
    for (const id of [
      "not-a-uuid",
      `${ORG}x`,
      `${ORG}' OR '1'='1`,
      ORG.toUpperCase().replace(/-/g, ""),
    ]) {
      expect((await as(OWNER, `/orgs/${encodeURIComponent(id)}`)).status).toBe(404);
    }
    expect(d1.log.length).toBe(before);
  });

  it("refuses an empty session account", async () => {
    expect((await as("", `/orgs/${ORG}`)).status).toBe(404);
  });
});

describe("limitsOf", () => {
  it("falls back to the free plan for unknown or missing orgs, within hard limits", async () => {
    d1.db.prepare("UPDATE orgs SET plan = 'made-up' WHERE id = ?").run(ORG);
    const unknown = await readJsonObject(await as(OWNER, `/orgs/${ORG}/limits`));
    const missing = await readJsonObject(await as(OWNER, `/orgs/${crypto.randomUUID()}/limits`));
    expect(unknown).toEqual(missing);
    expect(unknown.teams).toBeLessThanOrEqual(HARD_LIMITS.teams);
    expect(unknown.projects).toBeLessThanOrEqual(HARD_LIMITS.projects);
  });
});

describe("isGeneration", () => {
  it("accepts only non-negative safe integers", () => {
    expect([0, 1, 2 ** 53 - 1].every((value) => isGeneration(value))).toBe(true);
    for (const bad of [-1, 1.5, 2 ** 53, Number.NaN, Infinity, "1", null, undefined]) {
      expect(isGeneration(bad)).toBe(false);
    }
  });
});
