import { isOrgAdmin, type Principal } from "#core/org-model.js";
import { fail, ok, type Result } from "../http.js";
import type { AuditLog } from "./audit.js";
import type { ItemTables } from "./item-tables.js";
import type { LinkTables } from "./link-tables.js";
import type { ProjectTables } from "./project-tables.js";
import type { TeamTables } from "./team-tables.js";

export interface OrgContext {
  storage: DurableObjectStorage;
  teams: TeamTables;
  projects: ProjectTables;
  links: LinkTables;
  items: ItemTables;
  audit: AuditLog;
}

export type TeamKeyState = { generation: number; rekeyNeeded: boolean };

export function confirmed(org: OrgContext, principal: Principal): boolean {
  return org.teams.role(principal.accountId) === principal.role;
}

export function confirmedAdmin(org: OrgContext, principal: Principal): boolean {
  return confirmed(org, principal) && isOrgAdmin(principal.role);
}

export function teamAccess(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  adminOnly: boolean,
): Result<TeamKeyState> {
  if (!confirmed(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (adminOnly && !isOrgAdmin(principal.role)) {
    return fail(403, "orgs.forbidden");
  }
  const generation = org.teams.generationOf(teamId);
  if (generation === null) {
    return fail(404, "orgs.not_found");
  }
  if (!org.teams.inTeam(teamId, principal.accountId)) {
    return fail(403, "orgs.not_in_team");
  }
  return ok({ generation, rekeyNeeded: org.teams.rekeyNeeded(teamId) });
}

export function projectAccess(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  adminOnly: boolean,
): Result<TeamKeyState> {
  const access = teamAccess(org, principal, teamId, adminOnly);
  if (!access.ok) {
    return access;
  }
  if (org.projects.teamOf(projectId) !== teamId) {
    return fail(404, "orgs.not_found");
  }
  return access;
}

export function writable(access: TeamKeyState, generation: number) {
  if (access.rekeyNeeded) {
    return fail<never>(409, "orgs.rekey_required");
  }
  if (generation !== access.generation) {
    return fail<never>(409, "orgs.stale_team_key");
  }
  return null;
}

export function refusedEdit(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string | null,
  environmentIds: Iterable<string>,
) {
  if (isOrgAdmin(principal.role)) {
    return null;
  }
  if (org.teams.isViewer(teamId, principal.accountId)) {
    return fail<never>(403, "orgs.read_only");
  }
  if (projectId === null) {
    return null;
  }
  for (const environmentId of environmentIds) {
    if (org.projects.isProtected(projectId, environmentId)) {
      return fail<never>(403, "orgs.protected_environment");
    }
  }
  return null;
}
