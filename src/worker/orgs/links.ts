import { ruleAllows, type GithubClaims } from "../../core/ci.js";
import type { SealedData } from "../../core/crypto.js";
import type { Principal, WrappedKey } from "../../core/org-model.js";
import { fail, now, ok, type Result } from "../http.js";
import { projectAccess, writable, type OrgContext } from "./context.js";
import type { LinkRecord } from "./link-tables.js";

const MAX_LINKS_PER_PROJECT = 50;

export async function listLinks(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
): Promise<Result<{ links: LinkRecord[] }>> {
  const access = projectAccess(org, principal, teamId, projectId, false);
  if (!access.ok) {
    return access;
  }
  return ok({ links: org.links.ofProject(projectId) });
}

export async function createLink(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  link: Omit<LinkRecord, "createdBy" | "createdAt" | "lastUsedAt" | "projectId"> & {
    generation: number;
  },
  ip: string | null,
): Promise<Result<{ id: string }>> {
  const access = projectAccess(org, principal, teamId, projectId, true);
  if (!access.ok) {
    return access;
  }
  const refused = writable(access.value, link.generation);
  if (refused) {
    return refused;
  }
  if (org.links.find(link.id)) {
    return fail(409, "orgs.invalid_link");
  }
  if (org.links.count(projectId) >= MAX_LINKS_PER_PROJECT) {
    return fail(409, "orgs.link_limit", { limit: MAX_LINKS_PER_PROJECT });
  }
  org.links.insert(teamId, {
    id: link.id,
    projectId,
    environmentId: link.environmentId,
    repository: link.repository,
    branch: link.branch,
    githubEnvironment: link.githubEnvironment,
    publicKey: link.publicKey,
    wrappedKey: link.wrappedKey,
    createdBy: principal.accountId,
    createdAt: now(),
  });
  await org.audit.record(
    principal.accountId,
    "link.created",
    `${projectId}:${link.environmentId}`,
    ip,
  );
  return ok({ id: link.id });
}

export async function deleteLink(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  linkId: string,
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const access = projectAccess(org, principal, teamId, projectId, true);
  if (!access.ok) {
    return access;
  }
  const link = org.links.find(linkId);
  if (!link || link.projectId !== projectId) {
    return fail(404, "orgs.not_found");
  }
  org.links.remove(linkId);
  await org.audit.record(
    principal.accountId,
    "link.deleted",
    `${projectId}:${link.environmentId}`,
    ip,
  );
  return ok({ ok: true as const });
}

export async function ciRead(
  org: OrgContext,
  linkId: string,
  claims: GithubClaims,
  ip: string | null,
): Promise<
  Result<{
    projectId: string;
    environmentId: string;
    generation: number;
    wrappedKey: WrappedKey;
    secrets: { id: string; sealed: SealedData }[];
  }>
> {
  const link = org.links.find(linkId);
  if (!link || !ruleAllows(link, claims)) {
    return fail(403, "ci.forbidden");
  }
  const generation = org.teams.generationOf(link.teamId);
  if (generation === null) {
    return fail(403, "ci.forbidden");
  }
  const secrets = org.projects
    .secrets(link.projectId, link.environmentId)
    .map(({ id, sealed }) => ({ id, sealed }));
  org.links.touch(linkId, now());
  await org.audit.record(
    `github:${claims.repository}@${claims.ref}`,
    "ci.read",
    `${link.projectId}:${link.environmentId}`,
    ip,
  );
  return ok({
    projectId: link.projectId,
    environmentId: link.environmentId,
    generation,
    wrappedKey: link.wrappedKey,
    secrets,
  });
}
