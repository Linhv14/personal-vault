import type { SealedData } from "#core/crypto.js";
import type { Principal, TeamView } from "#core/org-model.js";
import { fail, now, ok, type Result } from "../http.js";
import { projectAccess, teamAccess, writable, type OrgContext } from "./context.js";
import type { ProjectRecord } from "./project-tables.js";
import { listTeams } from "./teams.js";

export async function listProjects(
  org: OrgContext,
  principal: Principal,
  teamId: string,
): Promise<Result<{ generation: number; rekeyNeeded: boolean; projects: ProjectRecord[] }>> {
  const access = teamAccess(org, principal, teamId, false);
  if (!access.ok) {
    return access;
  }
  return ok({
    generation: access.value.generation,
    rekeyNeeded: access.value.rekeyNeeded,
    projects: org.projects.ofTeam(teamId),
  });
}

export async function overview(
  org: OrgContext,
  principal: Principal,
): Promise<
  Result<{
    teams: TeamView[];
    projects: Record<string, { generation: number; projects: ProjectRecord[] }>;
  }>
> {
  const teams = await listTeams(org, principal);
  if (!teams.ok) {
    return teams;
  }
  const projects: Record<string, { generation: number; projects: ProjectRecord[] }> = {};
  for (const team of teams.value) {
    if (!team.wrappedKey) {
      continue;
    }
    const listed = await listProjects(org, principal, team.id);
    if (listed.ok) {
      projects[team.id] = {
        generation: listed.value.generation,
        projects: listed.value.projects,
      };
    }
  }
  return ok({ teams: teams.value, projects });
}

export async function createProject(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  project: { id: string; sealed: SealedData; generation: number },
  maxProjects: number,
  ip: string | null,
): Promise<Result<{ id: string }>> {
  const access = teamAccess(org, principal, teamId, true);
  if (!access.ok) {
    return access;
  }
  const refused = writable(access.value, project.generation);
  if (refused) {
    return refused;
  }
  if (org.projects.teamOf(project.id) !== null) {
    return fail(409, "orgs.invalid_project");
  }
  if (org.projects.count() >= maxProjects) {
    return fail(409, "orgs.project_limit", { limit: maxProjects });
  }
  org.projects.insert(teamId, project.id, project.sealed, principal.accountId, now());
  await org.audit.record(principal.accountId, "project.created", `${teamId}:${project.id}`, ip);
  return ok({ id: project.id });
}

export async function updateProject(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  update: { sealed: SealedData; generation: number },
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const access = projectAccess(org, principal, teamId, projectId, true);
  if (!access.ok) {
    return access;
  }
  const refused = writable(access.value, update.generation);
  if (refused) {
    return refused;
  }
  org.projects.replace(projectId, update.sealed);
  await org.audit.record(principal.accountId, "project.updated", `${teamId}:${projectId}`, ip);
  return ok({ ok: true as const });
}

export async function deleteProject(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const access = projectAccess(org, principal, teamId, projectId, true);
  if (!access.ok) {
    return access;
  }
  org.storage.transactionSync(() => {
    org.links.removeProject(projectId);
    org.projects.remove(projectId);
  });
  await org.audit.record(principal.accountId, "project.deleted", `${teamId}:${projectId}`, ip);
  return ok({ ok: true as const });
}

export async function protectEnvironment(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  environmentId: string,
  on: boolean,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const access = projectAccess(org, principal, teamId, projectId, true);
  if (!access.ok) {
    return access;
  }
  org.projects.protect(projectId, environmentId, on);
  await org.audit.record(
    principal.accountId,
    on ? "environment.protected" : "environment.unprotected",
    `${projectId}:${environmentId}`,
    ip,
  );
  return ok({ ok: true as const });
}
