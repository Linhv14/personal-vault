import type { SealedData } from "#core/crypto.js";
import { isWrappedForRecipient } from "#core/identity.js";
import { parseJsonAs } from "#core/json.js";
import {
  isOrgAdmin,
  type Principal,
  type TeamAccess,
  type TeamView,
  type WrappedKey,
} from "#core/org-model.js";
import { now } from "../clock.js";
import { fail, ok, type Result } from "../result.js";
import { confirmed, confirmedAdmin, type OrgContext } from "./context.js";

function sameKeys(ids: string[], map: Record<string, unknown>): boolean {
  return ids.length === Object.keys(map).length && ids.every((id) => id in map);
}

export async function listTeams(
  org: OrgContext,
  principal: Principal,
): Promise<Result<TeamView[]>> {
  if (!confirmed(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  const teams = org.teams.all();
  const memberships = org.teams.memberships();
  const invited = isOrgAdmin(principal.role) ? org.teams.invites() : [];
  const pending = isOrgAdmin(principal.role) ? org.teams.grants() : [];
  const visible = teams.filter(
    (team) =>
      isOrgAdmin(principal.role) ||
      memberships.some(
        (entry) => entry.team_id === team.id && entry.account_id === principal.accountId,
      ),
  );
  return ok(
    visible.map((team) => {
      const members = memberships.filter((entry) => entry.team_id === team.id);
      const mine = members.find((entry) => entry.account_id === principal.accountId);
      return {
        id: team.id,
        name: team.name,
        members: members.map((entry) => entry.account_id),
        viewers: members
          .filter((entry) => entry.access === "view")
          .map((entry) => entry.account_id),
        invited: invited
          .filter((entry) => entry.team_id === team.id)
          .map(({ email, access }) => ({ email, access })),
        pending: pending
          .filter((entry) => entry.team_id === team.id)
          .map(({ account_id, access }) => ({ accountId: account_id, access })),
        generation: team.key_generation,
        rekeyNeeded: team.rekey_needed === 1,
        wrappedKey: mine ? parseJsonAs(mine.wrapped_key, isWrappedForRecipient) : null,
      };
    }),
  );
}

export async function createTeam(
  org: OrgContext,
  principal: Principal,
  team: { id: string; name: string; wrappedKey: WrappedKey },
  maxTeams: number,
  ip: string | null,
): Promise<Result<{ id: string }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (org.teams.count() >= maxTeams) {
    return fail(409, "orgs.team_limit", { limit: maxTeams });
  }
  if (org.teams.exists(team.id)) {
    return fail(409, "orgs.invalid_team");
  }
  const at = now();
  org.storage.transactionSync(() => {
    org.teams.insert(team, principal.accountId, at);
  });
  await org.audit.record(principal.accountId, "team.created", team.id, ip);
  return ok({ id: team.id });
}

export async function addTeamMember(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  member: {
    accountId: string;
    wrappedKey: WrappedKey;
    generation: number;
    access?: TeamAccess;
  },
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  const generation = org.teams.generationOf(teamId);
  if (generation === null) {
    return fail(404, "orgs.not_found");
  }
  if (!org.teams.inTeam(teamId, principal.accountId)) {
    return fail(403, "orgs.not_in_team");
  }
  if (!org.teams.role(member.accountId)) {
    return fail(404, "orgs.not_found");
  }
  if (member.generation !== generation) {
    return fail(409, "orgs.stale_team_key");
  }
  org.teams.putMembership(teamId, member, principal.accountId, now());
  await org.audit.record(
    principal.accountId,
    "team.member_added",
    `${teamId}:${member.accountId}`,
    ip,
  );
  return ok({ ok: true as const });
}

export async function removeTeamMember(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  accountId: string,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (!org.teams.inTeam(teamId, accountId)) {
    return fail(404, "orgs.not_found");
  }
  org.storage.transactionSync(() => {
    org.teams.removeMembership(teamId, accountId);
    org.teams.flagRekey(teamId);
  });
  await org.audit.record(principal.accountId, "team.member_removed", `${teamId}:${accountId}`, ip);
  return ok({ ok: true as const });
}

export async function setTeamAccess(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  accountId: string,
  access: TeamAccess,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (!org.teams.inTeam(teamId, accountId)) {
    return fail(404, "orgs.not_found");
  }
  org.teams.setAccess(teamId, accountId, access);
  await org.audit.record(
    principal.accountId,
    access === "view" ? "team.member_view_only" : "team.member_can_edit",
    `${teamId}:${accountId}`,
    ip,
  );
  return ok({ ok: true as const });
}

export async function rekeyTeam(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  next: {
    generation: number;
    wrappedKeys: Record<string, WrappedKey>;
    projects: Record<string, SealedData>;
    secrets: Record<string, SealedData>;
    versions?: Record<string, SealedData>;
    links: Record<string, WrappedKey>;
    items: Record<string, SealedData>;
  },
  ip: string | null,
): Promise<Result<{ generation: number }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  const generation = org.teams.generationOf(teamId);
  if (generation === null) {
    return fail(404, "orgs.not_found");
  }
  if (!org.teams.inTeam(teamId, principal.accountId)) {
    return fail(403, "orgs.not_in_team");
  }
  if (next.generation !== generation + 1) {
    return fail(409, "orgs.stale_team_key");
  }
  const members = org.teams.members(teamId);
  if (!sameKeys(members, next.wrappedKeys)) {
    return fail(409, "orgs.team_changed");
  }
  const projectIds = org.projects.ofTeam(teamId).map((project) => project.id);
  const secretIds = org.projects.secretsOfTeam(teamId).map((secret) => secret.id);
  const linkIds = org.links.ofTeam(teamId).map((link) => link.id);
  const itemIds = org.items.ofTeam(teamId).map((item) => item.id);
  const versionIds = org.projects.versionsOfTeam(teamId).map((version) => version.id);
  if (
    (next.versions !== undefined && !sameKeys(versionIds, next.versions)) ||
    !sameKeys(projectIds, next.projects) ||
    !sameKeys(secretIds, next.secrets) ||
    !sameKeys(linkIds, next.links) ||
    !sameKeys(itemIds, next.items)
  ) {
    return fail(409, "orgs.team_changed");
  }
  org.storage.transactionSync(() => {
    if (next.versions === undefined) {
      org.projects.dropVersionsOfTeam(teamId);
    }
    org.projects.reseal(next.projects, next.secrets, next.versions ?? {});
    org.links.rewrap(next.links);
    org.items.reseal(next.items);
    org.teams.rekey(teamId, next.generation, members, next.wrappedKeys);
  });
  await org.audit.record(principal.accountId, "team.rekeyed", teamId, ip);
  return ok({ generation: next.generation });
}

export async function deleteTeam(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (!org.teams.exists(teamId)) {
    return fail(404, "orgs.not_found");
  }
  org.storage.transactionSync(() => {
    org.projects.removeTeam(teamId);
    org.links.removeTeam(teamId);
    org.items.removeTeam(teamId);
    org.teams.remove(teamId);
  });
  await org.audit.record(principal.accountId, "team.deleted", teamId, ip);
  return ok({ ok: true as const });
}
