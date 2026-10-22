import type { SealedData } from "../../core/crypto.js";
import type { Principal } from "../../core/org-model.js";
import { MAX_SECRETS_PER_PROJECT, type SecretAccess } from "../../core/projects.js";
import { fail, now, ok, type Result } from "../http.js";
import { projectAccess, refusedEdit, writable, type OrgContext } from "./context.js";
import type { SecretRecord, SecretVersionRecord } from "./project-tables.js";

export async function noteSecretAccess(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  events: { environmentId: string; access: SecretAccess }[],
  ip: string | null,
): Promise<Result<{ ok: true }>> {
  const allowed = projectAccess(org, principal, teamId, projectId, false);
  if (!allowed.ok) {
    return allowed;
  }
  for (const { environmentId, access } of events) {
    await org.audit.record(
      principal.accountId,
      access === "exported" ? "secrets.exported" : `secret.${access}`,
      `${projectId}:${environmentId}`,
      ip,
    );
  }
  return ok({ ok: true as const });
}

export async function readSecrets(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  environmentId: string,
  ip: string | null,
): Promise<Result<{ generation: number; secrets: SecretRecord[] }>> {
  const access = projectAccess(org, principal, teamId, projectId, false);
  if (!access.ok) {
    return access;
  }
  const secrets = org.projects.secrets(projectId, environmentId);
  await org.audit.record(principal.accountId, "secrets.read", `${projectId}:${environmentId}`, ip);
  return ok({ generation: access.value.generation, secrets });
}

export async function secretVersions(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  secretId: string,
  ip: string | null,
): Promise<Result<{ generation: number; environmentId: string; versions: SecretVersionRecord[] }>> {
  const access = projectAccess(org, principal, teamId, projectId, false);
  if (!access.ok) {
    return access;
  }
  const location = org.projects.secretLocation(secretId);
  if (location?.projectId !== projectId) {
    return fail(404, "orgs.not_found");
  }
  await org.audit.record(
    principal.accountId,
    "secret.history_read",
    `${projectId}:${location.environmentId}`,
    ip,
  );
  return ok({
    generation: access.value.generation,
    environmentId: location.environmentId,
    versions: org.projects.versions(secretId),
  });
}

export async function writeSecrets(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  batch: {
    generation: number;
    secrets: { id: string; environmentId: string; sealed: SealedData }[];
  },
  ip: string | null,
): Promise<Result<{ ids: string[] }>> {
  const access = projectAccess(org, principal, teamId, projectId, false);
  if (!access.ok) {
    return access;
  }
  const refused =
    writable(access.value, batch.generation) ??
    refusedEdit(
      org,
      principal,
      teamId,
      projectId,
      new Set(batch.secrets.map((secret) => secret.environmentId)),
    );
  if (refused) {
    return refused;
  }
  if (new Set(batch.secrets.map((secret) => secret.id)).size !== batch.secrets.length) {
    return fail(400, "orgs.invalid_secret");
  }
  let added = 0;
  for (const secret of batch.secrets) {
    const existing = org.projects.secretLocation(secret.id);
    if (!existing) {
      added += 1;
    } else if (
      existing.projectId !== projectId ||
      existing.environmentId !== secret.environmentId
    ) {
      return fail(409, "orgs.invalid_secret");
    }
  }
  if (org.projects.secretCount(projectId) + added > MAX_SECRETS_PER_PROJECT) {
    return fail(409, "orgs.secret_limit", { limit: MAX_SECRETS_PER_PROJECT });
  }
  const at = now();
  org.storage.transactionSync(() => {
    for (const secret of batch.secrets) {
      org.projects.putSecret({ ...secret, projectId }, principal.accountId, at);
    }
  });
  for (const environmentId of new Set(batch.secrets.map((secret) => secret.environmentId))) {
    await org.audit.record(
      principal.accountId,
      "secret.written",
      `${projectId}:${environmentId}`,
      ip,
    );
  }
  return ok({ ids: batch.secrets.map((secret) => secret.id) });
}

export async function deleteSecrets(
  org: OrgContext,
  principal: Principal,
  teamId: string,
  projectId: string,
  ids: string[],
  ip: string | null,
): Promise<Result<{ deleted: number }>> {
  const access = projectAccess(org, principal, teamId, projectId, false);
  if (!access.ok) {
    return access;
  }
  const found = ids
    .map((id) => ({ id, location: org.projects.secretLocation(id) }))
    .filter(({ location }) => location?.projectId === projectId);
  if (found.length === 0) {
    return fail(404, "orgs.not_found");
  }
  const refused = refusedEdit(
    org,
    principal,
    teamId,
    projectId,
    new Set(found.map(({ location }) => location!.environmentId)),
  );
  if (refused) {
    return refused;
  }
  org.storage.transactionSync(() => {
    for (const { id } of found) {
      org.projects.deleteSecret(id);
    }
  });
  for (const environmentId of new Set(found.map(({ location }) => location!.environmentId))) {
    await org.audit.record(
      principal.accountId,
      "secret.deleted",
      `${projectId}:${environmentId}`,
      ip,
    );
  }
  return ok({ deleted: found.length });
}
