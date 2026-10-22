import { Hono } from "hono";
import {
  canChangeRoles,
  canInvite,
  canRemove,
  isDomainAllowed,
  isInvitableRole,
  isOrgAdmin,
  isTeamAccess,
  parseDomains,
  planLimits,
  type TeamAccess,
} from "../../core/org-model.js";
import { verifyAuthKey } from "../at-rest.js";
import { normalizeEmail } from "../email-address.js";
import { apiError } from "../errors.js";
import { readJson, respond } from "../http.js";
import { MAX_ORGS_PER_ACCOUNT } from "../orgs/directory.js";
import { MAX_SECRET_VERSIONS } from "../orgs/project-tables.js";
import {
  invitationLink,
  joinFromInvite,
  notifyNewOwner,
  sendInvitation,
} from "../orgs/invitations.js";
import { clientIp } from "../request.js";
import { orgStore } from "../stores.js";
import type { AppBindings } from "../types.js";
import {
  displayName,
  isBase64,
  isUuid,
  isSealedProject,
  isSealedSecret,
  isSealedTeamItem,
  isWrappedKey,
} from "../validate.js";
import {
  admins,
  asMember,
  directory,
  forbidden,
  isGeneration,
  limitsOf,
  notFound,
  param,
  type Ctx,
} from "./org-access.js";
import projects from "./projects.js";

const orgs = new Hono<AppBindings>();
const MAX_RESEALED = 20_000;

function entriesOf<T>(
  value: unknown,
  max: number,
  valid: (entry: unknown) => entry is T,
): Record<string, T> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > max) {
    return null;
  }
  return entries.every(([id, entry]) => isUuid(id) && valid(entry))
    ? Object.fromEntries(entries)
    : null;
}

orgs.get("/", async (c) => c.json({ orgs: await directory(c).orgsOf(c.get("session").accountId) }));

orgs.post("/", async (c) => {
  const name = displayName((await readJson(c)).name);
  if (!name) {
    return c.json(apiError("orgs.invalid_name"), 400);
  }
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
    const [org, members, invites, overview] = await Promise.all([
      dir.org(orgId),
      dir.members(orgId),
      isOrgAdmin(member.role) ? dir.invites(orgId) : Promise.resolve([]),
      orgStore(c.env, orgId).overview(member),
    ]);
    if (!overview.ok) {
      return respond(c, overview);
    }
    return c.json({ org: { ...org, role: member.role }, members, invites, ...overview.value });
  }),
);

const MAX_INVITE_TEAMS = 50;

function inviteTeams(value: unknown): { teamId: string; access: TeamAccess }[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_INVITE_TEAMS) {
    return null;
  }
  const teams = value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const { teamId, access } = entry as Record<string, unknown>;
    return isUuid(teamId) && isTeamAccess(access) ? { teamId, access } : null;
  });
  if (teams.some((entry) => entry === null)) {
    return null;
  }
  const valid = teams as { teamId: string; access: TeamAccess }[];
  return new Set(valid.map((entry) => entry.teamId)).size === valid.length ? valid : null;
}

orgs.post(
  "/:orgId/invites",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    if (!email || !isInvitableRole(body.role)) {
      return c.json(apiError("orgs.invalid_invite"), 400);
    }
    const teams = inviteTeams(body.teams);
    if (!teams) {
      return c.json(apiError("orgs.invalid_invite"), 400);
    }
    if (!canInvite(member.role, body.role)) {
      return forbidden(c);
    }
    const dir = directory(c);
    const org = await dir.org(orgId);
    const { seats } = planLimits(org?.plan ?? "free");
    const allowed = org?.allowedDomains ?? [];
    if (!isDomainAllowed(email, allowed)) {
      return c.json(apiError("orgs.domain_not_allowed", { domains: allowed.join(", ") }), 400);
    }
    if ((await dir.seatsTaken(orgId, email)) >= seats) {
      return c.json(apiError("orgs.seat_limit", { limit: seats }), 409);
    }
    if (await dir.hasMemberWithEmail(orgId, email)) {
      return c.json(apiError("orgs.already_member"), 409);
    }
    const planned = await orgStore(c.env, orgId).planInvite(member, email, teams);
    if (!planned.ok) {
      return respond(c, planned);
    }
    const stored = await dir.invite(orgId, email, body.role, member.accountId);
    await orgStore(c.env, orgId).note(member.accountId, "member.invited", email, clientIp(c));
    const siteUrl = new URL(c.req.url).origin;
    const emailed = await sendInvitation(c.env, dir, {
      ...stored,
      orgId,
      email,
      role: body.role,
      invitedBy: member.accountId,
      locale: body.locale === "vi" ? "vi" : "en",
      siteUrl,
    });
    return c.json({ ...stored, emailed, link: invitationLink(siteUrl, stored.id) }, 201);
  }, admins),
);

orgs.delete(
  "/:orgId/invites/:inviteId",
  asMember(async (c, _member, orgId) => {
    const dir = directory(c);
    const withdrawn = (await dir.invites(orgId)).find(
      (invite) => invite.id === param(c, "inviteId"),
    );
    await dir.withdrawInvite(orgId, param(c, "inviteId"));
    if (withdrawn) {
      await orgStore(c.env, orgId).forgetInvite(withdrawn.email);
    }
    return c.json({ ok: true });
  }, admins),
);

orgs.put(
  "/:orgId/domains",
  asMember(
    async (c, member, orgId) => {
      const domains = parseDomains((await readJson(c)).domains);
      if (!domains) {
        return c.json(apiError("orgs.invalid_domains"), 400);
      }
      await directory(c).setAllowedDomains(orgId, domains);
      await orgStore(c.env, orgId).note(
        member.accountId,
        "org.domains_changed",
        domains.join(",") || null,
        clientIp(c),
      );
      return c.json({ allowedDomains: domains });
    },
    (member) => member.role === "owner",
  ),
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
      if (!(await directory(c).setRole(orgId, target, role))) {
        return notFound(c);
      }
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
      const { accountId, authKey, locale } = await readJson(c);
      if (typeof accountId !== "string" || accountId === member.accountId) {
        return c.json(apiError("orgs.invalid_role"), 400);
      }
      if (!isBase64(authKey, 32) || !(await ownerProof(c, member.accountId, authKey))) {
        return c.json(apiError("auth.invalid_credentials"), 403);
      }
      const dir = directory(c);
      const successor = await dir.transferCandidate(orgId, accountId);
      if (!successor) {
        return notFound(c);
      }
      if (successor.role !== "admin") {
        return c.json(apiError("orgs.transfer_needs_admin"), 400);
      }
      if (!successor.hasKey) {
        return c.json(apiError("orgs.transfer_needs_key"), 400);
      }
      const org = await dir.org(orgId);
      if (!isDomainAllowed(successor.email, org?.allowedDomains ?? [])) {
        return c.json(
          apiError("orgs.domain_not_allowed", { domains: (org?.allowedDomains ?? []).join(", ") }),
          400,
        );
      }
      if ((await dir.ownedCount(accountId)) >= MAX_ORGS_PER_ACCOUNT) {
        return c.json(apiError("orgs.limit_reached"), 409);
      }
      if (!(await dir.transferOwnership(orgId, member.accountId, accountId))) {
        return notFound(c);
      }
      await orgStore(c.env, orgId).transferOwnership(member.accountId, accountId, clientIp(c));
      c.executionCtx.waitUntil(
        notifyNewOwner(c.env, dir, {
          orgId,
          from: member.accountId,
          to: accountId,
          locale: locale === "vi" ? "vi" : "en",
          siteUrl: new URL(c.req.url).origin,
        }),
      );
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
    if (!role) {
      return notFound(c);
    }
    if (!canRemove(member, { accountId: target, role })) {
      return forbidden(c);
    }
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
    const { wrappedKey, generation = 0, access } = await readJson(c);
    if (
      !isWrappedKey(wrappedKey) ||
      !isGeneration(generation) ||
      (access !== undefined && !isTeamAccess(access))
    ) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    const target = { accountId: param(c, "accountId"), wrappedKey, generation, access };
    return respond(
      c,
      await orgStore(c.env, orgId).addTeamMember(member, param(c, "teamId"), target, clientIp(c)),
    );
  }),
);

orgs.put(
  "/:orgId/teams/:teamId/members/:accountId/access",
  asMember(async (c, member, orgId) => {
    const { access } = await readJson(c);
    if (!isTeamAccess(access)) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    return respond(
      c,
      await orgStore(c.env, orgId).setTeamAccess(
        member,
        param(c, "teamId"),
        param(c, "accountId"),
        access,
        clientIp(c),
      ),
    );
  }),
);

orgs.put(
  "/:orgId/teams/:teamId/key",
  asMember(async (c, member, orgId) => {
    const body = await readJson(c);
    const seats = (await limitsOf(c, orgId)).seats;
    const wrappedKeys = entriesOf(body.wrappedKeys, seats, isWrappedKey);
    const sealedProjects = entriesOf(body.projects ?? {}, MAX_RESEALED, isSealedProject);
    const sealedSecrets = entriesOf(body.secrets ?? {}, MAX_RESEALED, isSealedSecret);
    const linkKeys = entriesOf(body.links ?? {}, MAX_RESEALED, isWrappedKey);
    const sealedItems = entriesOf(body.items ?? {}, MAX_RESEALED, isSealedTeamItem);
    const sealedVersions =
      body.versions === undefined
        ? undefined
        : entriesOf(body.versions, MAX_RESEALED * MAX_SECRET_VERSIONS, isSealedSecret);
    if (
      !isGeneration(body.generation) ||
      !wrappedKeys ||
      Object.keys(wrappedKeys).length === 0 ||
      !sealedProjects ||
      !sealedSecrets ||
      !linkKeys ||
      !sealedItems ||
      sealedVersions === null
    ) {
      return c.json(apiError("orgs.invalid_team"), 400);
    }
    const next = {
      generation: body.generation,
      wrappedKeys,
      projects: sealedProjects,
      secrets: sealedSecrets,
      ...(sealedVersions ? { versions: sealedVersions } : {}),
      links: linkKeys,
      items: sealedItems,
    };
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

orgs.route("/:orgId/teams/:teamId", projects);

orgs.get(
  "/:orgId/audit",
  asMember(async (c, member, orgId) => {
    const before = Number(c.req.query("before"));
    const cursor = Number.isSafeInteger(before) && before > 0 ? before : undefined;
    return respond(c, await orgStore(c.env, orgId).audit(member, cursor));
  }),
);

async function ownerProof(c: Ctx, accountId: string, authKey: string): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT auth_key_hash FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ auth_key_hash: string }>();
  return row ? (await verifyAuthKey(c.env, authKey, row.auth_key_hash)).matches : false;
}

export const invites = new Hono<AppBindings>();

async function myEmail(c: Ctx): Promise<string> {
  return (await directory(c).emailOf(c.get("session").accountId)) ?? "";
}

invites.get("/", async (c) => c.json({ invites: await directory(c).invitesFor(await myEmail(c)) }));

invites.get("/:inviteId/preview", async (c) => {
  const inviteId = param(c, "inviteId");
  if (!isUuid(inviteId)) {
    return notFound(c);
  }
  const { success } = await c.env.ANONYMOUS_RATE_LIMITER.limit({ key: clientIp(c) ?? "unknown" });
  if (!success) {
    return c.json(apiError("server.rate_limited"), 429);
  }
  const invite = await directory(c).preview(inviteId);
  if (!invite) {
    return notFound(c);
  }
  return c.json(invite);
});

invites.post("/:inviteId/accept", async (c) => {
  const orgId = await joinFromInvite(c.env, directory(c), {
    id: param(c, "inviteId"),
    email: await myEmail(c),
    accountId: c.get("session").accountId,
    ip: clientIp(c),
  });
  if (orgId === "domain") {
    return c.json(apiError("orgs.invite_domain_blocked"), 403);
  }
  if (!orgId) {
    return notFound(c);
  }
  return c.json({ orgId });
});

invites.delete("/:inviteId", async (c) => {
  await directory(c).decline(param(c, "inviteId"), await myEmail(c));
  return c.json({ ok: true });
});

export default orgs;
