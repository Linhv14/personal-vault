import type { SealedData } from "#core/crypto.js";
import { isWrappedForRecipient } from "#core/identity.js";
import { parseJsonAs } from "#core/json.js";
import { isOrgAdmin, type Principal, type WrappedKey } from "#core/org-model.js";
import { MAX_TEAM_ITEMS, MAX_TEAM_VAULT_BYTES } from "#core/team-items.js";
import { now } from "../clock.js";
import { fail, ok, type Result } from "../result.js";
import { confirmed, refusedEdit, teamAccess, writable, type OrgContext } from "./context.js";
import type { TeamItemRecord } from "./item-tables.js";
import type { ProjectRecord, SecretRecord } from "./project-tables.js";

export async function teamVault(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  ip: string | null,
): Promise<
  Result<{
    generation: number;
    projects: ProjectRecord[];
    secrets: SecretRecord[];
    versions: { id: string; secretId: string; sealed: SealedData }[];
    links: { id: string; projectId: string; environmentId: string; publicKey: string }[];
    items: TeamItemRecord[];
  }>
> {
  const access = teamAccess(org, principal, teamId, true);
  if (!access.ok) {
    return access;
  }
  const vault = {
    generation: access.value.generation,
    projects: org.projects.ofTeam(teamId),
    secrets: org.projects.secretsOfTeam(teamId),
    versions: org.projects.versionsOfTeam(teamId),
    links: org.links.ofTeam(teamId).map(({ id, projectId, environmentId, publicKey }) => ({
      id,
      projectId,
      environmentId,
      publicKey,
    })),
    items: org.items.ofTeam(teamId),
  };
  await org.audit.record(principal.accountId, "team.vault_read", teamId, ip);
  return ok(vault);
}

export async function sharedVaults(
  org: OrgContext,
  principal: Principal,
): Promise<
  Result<
    {
      teamId: string;
      name: string;
      generation: number;
      rekeyNeeded: boolean;
      viewOnly: boolean;
      wrappedKey: WrappedKey;
      items: TeamItemRecord[];
    }[]
  >
> {
  if (!confirmed(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  return ok(
    org.teams.sharedWith(principal.accountId).map((row) => ({
      teamId: row.id,
      name: row.name,
      generation: row.key_generation,
      rekeyNeeded: row.rekey_needed === 1,
      viewOnly: row.access === "view" && !isOrgAdmin(principal.role),
      wrappedKey: parseJsonAs(row.wrapped_key, isWrappedForRecipient),
      items: org.items.ofTeam(row.id),
    })),
  );
}

export async function putTeamItem(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  item: { id: string; sealed: SealedData; generation: number },
  ip: string | null,
): Promise<Result<{ updatedAt: number }>> {
  const access = teamAccess(org, principal, teamId, false);
  if (!access.ok) {
    return access;
  }
  const refused =
    writable(access.value, item.generation) ?? refusedEdit(org, principal, teamId, null, []);
  if (refused) {
    return refused;
  }
  const owner = org.items.teamOf(item.id);
  if (owner !== null && owner !== teamId) {
    return fail(409, "orgs.invalid_item");
  }
  if (owner === null && org.items.count(teamId) >= MAX_TEAM_ITEMS) {
    return fail(409, "orgs.item_limit", { limit: MAX_TEAM_ITEMS });
  }
  const size = JSON.stringify(item.sealed).length;
  if (org.items.bytes(teamId, item.id) + size > MAX_TEAM_VAULT_BYTES) {
    return fail(409, "orgs.vault_full", { megabytes: MAX_TEAM_VAULT_BYTES / 1024 / 1024 });
  }
  const updatedAt = now();
  org.items.put(teamId, item.id, item.sealed, principal.accountId, updatedAt);
  await org.audit.record(principal.accountId, "team.item_saved", teamId, ip);
  return ok({ updatedAt });
}

export async function deleteTeamItem(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  itemId: string,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const access = teamAccess(org, principal, teamId, false);
  if (!access.ok) {
    return access;
  }
  if (org.items.teamOf(itemId) !== teamId) {
    return fail(404, "orgs.not_found");
  }
  const refused = refusedEdit(org, principal, teamId, null, []);
  if (refused) {
    return refused;
  }
  org.items.remove(itemId);
  await org.audit.record(principal.accountId, "team.item_deleted", teamId, ip);
  return ok({ ok: true as const });
}
