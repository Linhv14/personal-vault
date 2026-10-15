import { Hono, type Context } from "hono";
import {
  canChangeRoles,
  canInvite,
  canRemove,
  isInvitableRole,
  isOrgAdmin,
  planLimits,
  type Principal,
} from "../../core/org-model.js";
import { normalizeEmail } from "../email-address.js";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { MAX_ORGS_PER_ACCOUNT, OrgDirectory } from "../orgs/directory.js";
import { sendInvitation } from "../orgs/invitations.js";
import { clientIp } from "../request.js";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import { displayName, isUuid, isWrappedKey } from "../validate.js";

const isGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

async function limitsOf(c: Ctx, orgId: string) {
  return planLimits((await directory(c).org(orgId))?.plan ?? "free");
}

type Ctx = Context<AppBindings>;
type MemberHandler = (c: Ctx, member: Principal, orgId: string) => Promise<Response>;

const orgs = new Hono<AppBindings>();

const param = (c: Ctx, name: string) => c.req.param(name) ?? "";
const directory = (c: Ctx) => new OrgDirectory(c.env.DB);
const notFound = (c: Ctx) => c.json(apiError("orgs.not_found"), 404);
const forbidden = (c: Ctx) => c.json(apiError("orgs.forbidden"), 403);

function asMember(handler: MemberHandler, rule: (member: Principal) => boolean = () => true) {
  return async (c: Ctx) => {
    const orgId = param(c, "orgId");
    if (!isUuid(orgId)) return notFound(c);
    const accountId = c.get("session").accountId;
    const role = await directory(c).roleOf(orgId, accountId);
    if (!role) return notFound(c);
    const member = { accountId, role };
    return rule(member) ? handler(c, member, orgId) : forbidden(c);
  };
}

const admins = (member: Principal) => isOrgAdmin(member.role);

orgs.get("/", async (c) => c.json({ orgs: await directory(c).orgsOf(c.get("session").accountId) }));

orgs.post("/", async (c) => {
  const name = displayName((await readJson(c)).name);
  if (!name) return c.json(apiError("orgs.invalid_name"), 400);
  const accountId = c.get("session").accountId;
  if ((await directory(c).ownedCount(accountId)) >= MAX_ORGS_PER_ACCOUNT) {
    return c.json(apiError("orgs.limit_reached"), 409);
  }
  const id = crypto.randomUUID();
  await directory(c).create(id, name, accountId);
  await orgStore(c.env, id).setMember(
    accountId,
    { accountId, role: "owner" },
    "org.created",
    clientIp(c),
  );
  return c.json({ id, name, role: "owner" }, 201);
});

orgs.get(
  "/:orgId",
  asMember(async (c, member, orgId) => {
    const dir = directory(c);
    const [org, members, invites, teams] = await Promise.all([
      dir.org(orgId),
      dir.members(orgId),
      isOrgAdmin(member.role) ? dir.invites(orgId) : Promise.resolve([]),
      orgStore(c.env, orgId).listTeams(member),
    ]);
    if (!teams.ok) return respond(c, teams);
    return c.json({ org: { ...org, role: member.role }, members, invites, teams: teams.value });
  }),
);

orgs.post(
  "/:orgId/invites",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    if (!email || !isInvitableRole(body.role)) return c.json(apiError("orgs.invalid_invite"), 400);
    if (!canInvite(member.role, body.role)) return forbidden(c);
    const dir = directory(c);
    const { seats } = await limitsOf(c, orgId);
    if ((await dir.seatsTaken(orgId, email)) >= seats) {
      return c.json(apiError("orgs.seat_limit", { limit: seats }), 409);
    }
    if (await dir.hasMemberWithEmail(orgId, email)) {
      return c.json(apiError("orgs.already_member"), 409);
    }
    await dir.invite(orgId, email, body.role, member.accountId);
    await orgStore(c.env, orgId).note(member.accountId, "member.invited", email, clientIp(c));
    await sendInvitation(c.env, dir, {
      orgId,
      email,
      invitedBy: member.accountId,
      locale: body.locale === "vi" ? "vi" : "en",
      siteUrl: new URL(c.req.url).origin,
    });
    return c.json({ ok: true }, 201);
  }, admins),
);

orgs.delete(
  "/:orgId/invites/:inviteId",
  asMember(async (c, _member, orgId) => {
    await directory(c).withdrawInvite(orgId, param(c, "inviteId"));
    return c.json({ ok: true });
  }, admins),
);

orgs.patch(
  "/:orgId/members/:accountId",
  asMember(
    async (c, member, orgId) => {
      const target = param(c, "accountId");
      const { role } = await readJson(c);
      if (!isInvitableRole(role) || target === member.accountId) {
        return c.json(apiError("orgs.invalid_role"), 400);
      }
      if (!(await directory(c).setRole(orgId, target, role))) return notFound(c);
      await orgStore(c.env, orgId).setMember(
        member.accountId,
        { accountId: target, role },
        "member.role_changed",
        clientIp(c),
      );
      return c.json({ ok: true });
    },
    (member) => canChangeRoles(member.role),
  ),
);

orgs.post(
  "/:orgId/owner",
  asMember(
    async (c, member, orgId) => {
      const { accountId } = await readJson(c);
      if (typeof accountId !== "string" || accountId === member.accountId) {
        return c.json(apiError("orgs.invalid_role"), 400);
      }
      const dir = directory(c);
      if ((await dir.roleOf(orgId, accountId)) === null) return notFound(c);
      if ((await dir.ownedCount(accountId)) >= MAX_ORGS_PER_ACCOUNT) {
        return c.json(apiError("orgs.limit_reached"), 409);
      }
      if (!(await dir.transferOwnership(orgId, member.accountId, accountId))) return notFound(c);
      await orgStore(c.env, orgId).transferOwnership(member.accountId, accountId, clientIp(c));
      return c.json({ ok: true });
    },
    (member) => member.role === "owner",
  ),
);

orgs.delete(
  "/:orgId/members/:accountId",
  asMember(async (c, member, orgId) => {
    const target = param(c, "accountId");
    const dir = directory(c);
    const role = await dir.roleOf(orgId, target);
    if (!role) return notFound(c);
    if (!canRemove(member, { accountId: target, role })) return forbidden(c);
    await dir.removeMember(orgId, target);
    await orgStore(c.env, orgId).removeMember(member.accountId, target, clientIp(c));
    return c.json({ ok: true });
  }),
);

orgs.post(
  "/:orgId/teams",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const name = displayName(body.name);
    if (!name || !isUuid(body.id) || !isWrappedKey(body.wrappedKey)) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    const team = { id: body.id, name, wrappedKey: body.wrappedKey };
    const { teams } = await limitsOf(c, orgId);
    return respond(
      c,
      await orgStore(c.env, orgId).createTeam(member, team, teams, clientIp(c)),
      201,
    );
  }),
);

orgs.delete(
  "/:orgId/teams/:teamId",
  asMember(async (c, member, orgId) =>
    respond(c, await orgStore(c.env, orgId).deleteTeam(member, param(c, "teamId"), clientIp(c))),
  ),
);

orgs.put(
  "/:orgId/teams/:teamId/members/:accountId",
  asMember(async (c, member, orgId) => {
    const { wrappedKey, generation = 0 } = await readJson(c);
    if (!isWrappedKey(wrappedKey) || !isGeneration(generation)) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    const target = { accountId: param(c, "accountId"), wrappedKey, generation };
    return respond(
      c,
      await orgStore(c.env, orgId).addTeamMember(member, param(c, "teamId"), target, clientIp(c)),
    );
  }),
);

orgs.put(
  "/:orgId/teams/:teamId/key",
  asMember(async (c, member, orgId) => {
    const { generation, wrappedKeys } = await readJson(c);
    const entries =
      typeof wrappedKeys === "object" && wrappedKeys !== null ? Object.entries(wrappedKeys) : [];
    if (
      !isGeneration(generation) ||
      entries.length === 0 ||
      entries.length > (await limitsOf(c, orgId)).seats ||
      !entries.every(([accountId, key]) => isUuid(accountId) && isWrappedKey(key))
    ) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    const next = { generation, wrappedKeys: Object.fromEntries(entries) };
    return respond(
      c,
      await orgStore(c.env, orgId).rekeyTeam(member, param(c, "teamId"), next, clientIp(c)),
    );
  }),
);

orgs.delete(
  "/:orgId/teams/:teamId/members/:accountId",
  asMember(async (c, member, orgId) =>
    respond(
      c,
      await orgStore(c.env, orgId).removeTeamMember(
        member,
        param(c, "teamId"),
        param(c, "accountId"),
        clientIp(c),
      ),
    ),
  ),
);

orgs.get(
  "/:orgId/audit",
  asMember(async (c, member, orgId) => {
    const before = Number(c.req.query("before"));
    const cursor = Number.isSafeInteger(before) && before > 0 ? before : undefined;
    return respond(c, await orgStore(c.env, orgId).audit(member, cursor));
  }),
);

export const invites = new Hono<AppBindings>();

async function myEmail(c: Ctx): Promise<string> {
  return (await directory(c).emailOf(c.get("session").accountId)) ?? "";
}

invites.get("/", async (c) => c.json({ invites: await directory(c).invitesFor(await myEmail(c)) }));

invites.post("/:inviteId/accept", async (c) => {
  const accountId = c.get("session").accountId;
  const invite = await directory(c).accept(param(c, "inviteId"), await myEmail(c), accountId);
  if (!invite) return notFound(c);
  await orgStore(c.env, invite.orgId).setMember(
    accountId,
    { accountId, role: invite.role },
    "member.joined",
    clientIp(c),
  );
  return c.json({ orgId: invite.orgId });
});

invites.delete("/:inviteId", async (c) => {
  await directory(c).decline(param(c, "inviteId"), await myEmail(c));
  return c.json({ ok: true });
});

export default orgs;
