import { Hono, type Context } from "hono";
import { normalizeEmail } from "../email-address.js";
import { orgInviteEmail } from "../emails.js";
import { apiError, type ApiErrorCode } from "../errors.js";
import { createMailer } from "../mailer.js";
import type { OrgResult, OrgRole, Principal, WrappedKey } from "../org-store.js";
import { clientIp } from "../request.js";
import { isBase64 } from "../session.js";
import type { AppBindings } from "../types.js";

const orgs = new Hono<AppBindings>();

const MAX_ORGS_PER_ACCOUNT = 10;
const MAX_MEMBERS_PER_ORG = 500;
const INVITE_TTL_SECONDS = 14 * 24 * 60 * 60;
const ROLES: OrgRole[] = ["owner", "admin", "member"];

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f]/.test(name) ? name : null;
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isWrappedKey(value: unknown): value is WrappedKey {
  if (typeof value !== "object" || value === null) return false;
  const { ephemeralPublicKey, sealed } = value as Record<string, unknown>;
  if (!isBase64(ephemeralPublicKey, 128) || typeof sealed !== "object" || sealed === null) {
    return false;
  }
  const { ciphertext, nonce } = sealed as Record<string, unknown>;
  return isBase64(ciphertext, 256) && isBase64(nonce, 12);
}

function store(c: Context<AppBindings>, orgId: string) {
  const { ORG_STORE } = c.env;
  return ORG_STORE.get(ORG_STORE.idFromName(`org:${orgId}`));
}

async function principal(c: Context<AppBindings>, orgId: string): Promise<Principal | null> {
  if (!isId(orgId)) return null;
  const accountId = c.get("session").accountId;
  const row = await c.env.DB.prepare(
    "SELECT role FROM org_members WHERE org_id = ? AND account_id = ?",
  )
    .bind(orgId, accountId)
    .first<{ role: OrgRole }>();
  return row ? { accountId, role: row.role } : null;
}

function isAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

function respond<T>(c: Context<AppBindings>, result: OrgResult<T>) {
  return result.ok
    ? c.json(result.value as object)
    : c.json(apiError(result.code as ApiErrorCode), result.status);
}

const notFound = (c: Context<AppBindings>) => c.json(apiError("orgs.not_found"), 404);
const forbidden = (c: Context<AppBindings>) => c.json(apiError("orgs.forbidden"), 403);

orgs.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.plan, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id
      WHERE m.account_id = ? ORDER BY o.name`,
  )
    .bind(c.get("session").accountId)
    .all<{ id: string; name: string; plan: string; role: OrgRole }>();
  return c.json({ orgs: results });
});

orgs.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanName(body?.name);
  if (!name) return c.json(apiError("orgs.invalid_name"), 400);
  const accountId = c.get("session").accountId;
  const owned = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM org_members WHERE account_id = ? AND role = 'owner'",
  )
    .bind(accountId)
    .first<{ n: number }>();
  if ((owned?.n ?? 0) >= MAX_ORGS_PER_ACCOUNT) return c.json(apiError("orgs.limit_reached"), 409);
  const id = crypto.randomUUID();
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO orgs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    ).bind(id, name, accountId, at),
    c.env.DB.prepare(
      "INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, accountId, at),
  ]);
  await store(c, id).setMember(accountId, { accountId, role: "owner" }, "org.created", clientIp(c));
  return c.json({ id, name, role: "owner" }, 201);
});

orgs.get("/:orgId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  const [org, members, invites, teams] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, plan FROM orgs WHERE id = ?")
      .bind(orgId)
      .first<{ id: string; name: string; plan: string }>(),
    c.env.DB.prepare(
      `SELECT m.account_id AS accountId, a.email, m.role, a.public_key AS publicKey
         FROM org_members m JOIN accounts a ON a.id = m.account_id
        WHERE m.org_id = ?
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, a.email`,
    )
      .bind(orgId)
      .all<{ accountId: string; email: string; role: OrgRole; publicKey: string | null }>(),
    isAdmin(me.role)
      ? c.env.DB.prepare(
          `SELECT id, email, role, expires_at AS expiresAt FROM org_invites
            WHERE org_id = ? AND expires_at > ? ORDER BY created_at`,
        )
          .bind(orgId, now())
          .all<{ id: string; email: string; role: OrgRole; expiresAt: number }>()
      : Promise.resolve({ results: [] }),
    store(c, orgId).listTeams(me),
  ]);
  if (!teams.ok) return respond(c, teams);
  return c.json({
    org: { ...org, role: me.role },
    members: members.results,
    invites: invites.results,
    teams: teams.value,
  });
});

orgs.post("/:orgId/invites", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  if (!isAdmin(me.role)) return forbidden(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normalizeEmail(body?.email);
  const role = body?.role === "admin" ? "admin" : body?.role === "member" ? "member" : null;
  if (!email || !role) return c.json(apiError("orgs.invalid_invite"), 400);
  if (role === "admin" && me.role !== "owner") return forbidden(c);
  const count = await c.env.DB.prepare("SELECT count(*) AS n FROM org_members WHERE org_id = ?")
    .bind(orgId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MEMBERS_PER_ORG) return c.json(apiError("orgs.limit_reached"), 409);
  const already = await c.env.DB.prepare(
    `SELECT 1 FROM org_members m JOIN accounts a ON a.id = m.account_id
      WHERE m.org_id = ? AND a.email = ?`,
  )
    .bind(orgId, email)
    .first();
  if (already) return c.json(apiError("orgs.already_member"), 409);
  const id = crypto.randomUUID();
  const at = now();
  await c.env.DB.prepare(
    `INSERT INTO org_invites (id, org_id, email, role, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by,
       created_at = excluded.created_at, expires_at = excluded.expires_at`,
  )
    .bind(id, orgId, email, role, me.accountId, at, at + INVITE_TTL_SECONDS)
    .run();
  await store(c, orgId).note(me.accountId, "member.invited", email, clientIp(c));

  const mailer = createMailer(c.env);
  if (mailer) {
    const [org, inviter] = await Promise.all([
      c.env.DB.prepare("SELECT name FROM orgs WHERE id = ?").bind(orgId).first<{ name: string }>(),
      c.env.DB.prepare("SELECT email FROM accounts WHERE id = ?")
        .bind(me.accountId)
        .first<{ email: string }>(),
    ]);
    const message = orgInviteEmail(
      { locale: body?.locale === "vi" ? "vi" : "en", siteUrl: new URL(c.req.url).origin },
      org?.name ?? "",
      inviter?.email ?? "",
    );
    await mailer.send({ to: email, ...message }).catch(() => {});
  }
  return c.json({ ok: true }, 201);
});

orgs.delete("/:orgId/invites/:inviteId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  if (!isAdmin(me.role)) return forbidden(c);
  await c.env.DB.prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?")
    .bind(c.req.param("inviteId"), orgId)
    .run();
  return c.json({ ok: true });
});

orgs.patch("/:orgId/members/:accountId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  if (me.role !== "owner") return forbidden(c);
  const target = c.req.param("accountId");
  const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null;
  const role = body?.role === "admin" || body?.role === "member" ? body.role : null;
  if (!role || target === me.accountId) return c.json(apiError("orgs.invalid_role"), 400);
  const result = await c.env.DB.prepare(
    "UPDATE org_members SET role = ? WHERE org_id = ? AND account_id = ? AND role != 'owner'",
  )
    .bind(role, orgId, target)
    .run();
  if (!result.meta.changes) return notFound(c);
  await store(c, orgId).setMember(
    me.accountId,
    { accountId: target, role },
    "member.role_changed",
    clientIp(c),
  );
  return c.json({ ok: true });
});

orgs.delete("/:orgId/members/:accountId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  const target = c.req.param("accountId");
  const row = await c.env.DB.prepare(
    "SELECT role FROM org_members WHERE org_id = ? AND account_id = ?",
  )
    .bind(orgId, target)
    .first<{ role: OrgRole }>();
  if (!row) return notFound(c);
  const leaving = target === me.accountId;
  const allowed =
    row.role !== "owner" &&
    (leaving || me.role === "owner" || (me.role === "admin" && row.role === "member"));
  if (!allowed) return forbidden(c);
  await c.env.DB.prepare("DELETE FROM org_members WHERE org_id = ? AND account_id = ?")
    .bind(orgId, target)
    .run();
  await store(c, orgId).removeMember(me.accountId, target, clientIp(c));
  return c.json({ ok: true });
});

orgs.post("/:orgId/teams", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = cleanName(body?.name);
  if (!name || !isWrappedKey(body?.wrappedKey)) return c.json(apiError("orgs.invalid_team"), 400);
  const id = crypto.randomUUID();
  const result = await store(c, orgId).createTeam(
    me,
    { id, name, wrappedKey: body.wrappedKey },
    clientIp(c),
  );
  return result.ok ? c.json({ id, name }, 201) : respond(c, result);
});

orgs.delete("/:orgId/teams/:teamId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  return respond(c, await store(c, orgId).deleteTeam(me, c.req.param("teamId"), clientIp(c)));
});

orgs.put("/:orgId/teams/:teamId/members/:accountId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  const body = (await c.req.json().catch(() => null)) as { wrappedKey?: unknown } | null;
  if (!isWrappedKey(body?.wrappedKey)) return c.json(apiError("orgs.invalid_team"), 400);
  return respond(
    c,
    await store(c, orgId).addTeamMember(
      me,
      c.req.param("teamId"),
      { accountId: c.req.param("accountId"), wrappedKey: body.wrappedKey },
      clientIp(c),
    ),
  );
});

orgs.delete("/:orgId/teams/:teamId/members/:accountId", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  return respond(
    c,
    await store(c, orgId).removeTeamMember(
      me,
      c.req.param("teamId"),
      c.req.param("accountId"),
      clientIp(c),
    ),
  );
});

orgs.get("/:orgId/audit", async (c) => {
  const orgId = c.req.param("orgId");
  const me = await principal(c, orgId);
  if (!me) return notFound(c);
  const before = Number(c.req.query("before"));
  return respond(
    c,
    await store(c, orgId).audit(
      me,
      Number.isSafeInteger(before) && before > 0 ? before : undefined,
    ),
  );
});

export const invites = new Hono<AppBindings>();

async function myEmail(c: Context<AppBindings>): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT email FROM accounts WHERE id = ?")
    .bind(c.get("session").accountId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

invites.get("/", async (c) => {
  const email = await myEmail(c);
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.org_id AS orgId, o.name AS orgName, i.role, i.expires_at AS expiresAt
       FROM org_invites i JOIN orgs o ON o.id = i.org_id
      WHERE i.email = ? AND i.expires_at > ? ORDER BY i.created_at`,
  )
    .bind(email, now())
    .all();
  return c.json({ invites: results });
});

invites.post("/:inviteId/accept", async (c) => {
  const email = await myEmail(c);
  const accountId = c.get("session").accountId;
  const invite = await c.env.DB.prepare(
    "SELECT id, org_id, role FROM org_invites WHERE id = ? AND email = ? AND expires_at > ?",
  )
    .bind(c.req.param("inviteId"), email, now())
    .first<{ id: string; org_id: string; role: OrgRole }>();
  if (!invite || !ROLES.includes(invite.role)) return notFound(c);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, account_id) DO NOTHING`,
    ).bind(invite.org_id, accountId, invite.role, now()),
    c.env.DB.prepare("DELETE FROM org_invites WHERE id = ?").bind(invite.id),
  ]);
  const member = await principal(c, invite.org_id);
  if (member) {
    await store(c, invite.org_id).setMember(accountId, member, "member.joined", clientIp(c));
  }
  return c.json({ orgId: invite.org_id });
});

invites.delete("/:inviteId", async (c) => {
  const email = await myEmail(c);
  await c.env.DB.prepare("DELETE FROM org_invites WHERE id = ? AND email = ?")
    .bind(c.req.param("inviteId"), email)
    .run();
  return c.json({ ok: true });
});

export default orgs;
