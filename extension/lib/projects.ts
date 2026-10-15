import type { SealedData } from "../../src/core/crypto.js";
import { wrapForRecipient, randomKey, type Identity } from "../../src/core/identity.js";
import { teamKeyContext, type WrappedKey } from "../../src/core/org-model.js";
import {
  newProject,
  openProject,
  openSecret,
  sealProject,
  sealSecret,
  type ProjectContent,
  type SecretContent,
} from "../../src/core/projects.js";
import { toBase64 } from "../../src/core/bytes.js";
import { request } from "./api.js";
import { teamKey, type OrgMember, type Team } from "./orgs.js";

export interface Project {
  id: string;
  teamId: string;
  generation: number;
  content: ProjectContent;
  createdAt: number;
  secretCount: number;
  updatedAt: number;
}

export interface Secret extends SecretContent {
  id: string;
  environmentId: string;
  updatedAt: number;
  updatedBy: string;
}

interface ProjectRecord {
  id: string;
  sealed: SealedData;
  createdAt: number;
  secretCount: number;
  updatedAt: number;
}

interface SecretRecord {
  id: string;
  projectId: string;
  environmentId: string;
  sealed: SealedData;
  updatedAt: number;
  updatedBy: string;
}

const json = (body: unknown) => JSON.stringify(body);
const teamPath = (orgId: string, teamId: string) => `/api/orgs/${orgId}/teams/${teamId}`;

const address = (project: Project, environmentId: string, secretId: string) => ({
  projectId: project.id,
  generation: project.generation,
  environmentId,
  secretId,
});

export async function listProjects(orgId: string, team: Team, me: Identity): Promise<Project[]> {
  const { generation, projects } = await request<{
    generation: number;
    projects: ProjectRecord[];
  }>(`${teamPath(orgId, team.id)}/projects`);
  const key = await teamKey({ ...team, generation }, me);
  return Promise.all(
    projects.map(async (record) => ({
      id: record.id,
      teamId: team.id,
      generation,
      content: await openProject(key, record.id, generation, record.sealed),
      createdAt: record.createdAt,
      secretCount: record.secretCount,
      updatedAt: record.updatedAt,
    })),
  );
}

export async function createProject(
  orgId: string,
  team: Team,
  me: Identity,
  name: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const sealed = await sealProject(await teamKey(team, me), id, team.generation, newProject(name));
  await request(`${teamPath(orgId, team.id)}/projects`, {
    method: "POST",
    body: json({ id, sealed, generation: team.generation }),
  });
  return id;
}

export async function updateProject(
  orgId: string,
  team: Team,
  me: Identity,
  project: Project,
  content: ProjectContent,
): Promise<void> {
  const sealed = await sealProject(
    await teamKey(team, me),
    project.id,
    project.generation,
    content,
  );
  await request(`${teamPath(orgId, team.id)}/projects/${project.id}`, {
    method: "PUT",
    body: json({ sealed, generation: project.generation }),
  });
}

export async function deleteProject(orgId: string, project: Project): Promise<void> {
  await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}`, {
    method: "DELETE",
  });
}

export async function listSecrets(
  orgId: string,
  project: Project,
  environmentId: string,
): Promise<Secret[]> {
  const { secrets } = await request<{ secrets: SecretRecord[] }>(
    `${teamPath(orgId, project.teamId)}/projects/${project.id}/environments/${environmentId}/secrets`,
  );
  const opened = await Promise.all(
    secrets.map(async (record) => ({
      ...(await openSecret(
        project.content,
        address(project, environmentId, record.id),
        record.sealed,
      )),
      id: record.id,
      environmentId,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    })),
  );
  return opened.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSecret(
  orgId: string,
  project: Project,
  environmentId: string,
  secret: SecretContent & { id?: string },
): Promise<void> {
  const id = secret.id ?? crypto.randomUUID();
  const content: SecretContent = { name: secret.name, value: secret.value };
  if (secret.note) content.note = secret.note;
  const sealed = await sealSecret(project.content, address(project, environmentId, id), content);
  await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/secrets/${id}`, {
    method: "PUT",
    body: json({ environmentId, sealed, generation: project.generation }),
  });
}

export async function importSecrets(
  orgId: string,
  project: Project,
  environmentId: string,
  existing: Secret[],
  entries: SecretContent[],
): Promise<number> {
  for (const entry of entries) {
    const current = existing.find((secret) => secret.name === entry.name);
    await saveSecret(orgId, project, environmentId, { ...entry, id: current?.id });
  }
  return entries.length;
}

export async function deleteSecret(
  orgId: string,
  project: Project,
  secretId: string,
): Promise<void> {
  await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/secrets/${secretId}`, {
    method: "DELETE",
  });
}

export async function rekeyTeam(
  orgId: string,
  team: Team,
  members: OrgMember[],
  me: Identity,
): Promise<void> {
  const vault = await request<{
    generation: number;
    projects: ProjectRecord[];
    secrets: SecretRecord[];
  }>(`${teamPath(orgId, team.id)}/vault`);
  const current = vault.generation;
  const generation = current + 1;
  const oldKey = await teamKey({ ...team, generation: current }, me);
  const newKey = randomKey();

  const wrappedKeys: Record<string, WrappedKey> = {};
  for (const accountId of team.members) {
    const publicKey = members.find((member) => member.accountId === accountId)?.publicKey;
    if (!publicKey) throw new Error("member has no key yet");
    wrappedKeys[accountId] = await wrapForRecipient(
      publicKey,
      newKey,
      teamKeyContext(team.id, generation),
    );
  }

  const projects: Record<string, SealedData> = {};
  const secrets: Record<string, SealedData> = {};
  for (const record of vault.projects) {
    const before = await openProject(oldKey, record.id, current, record.sealed);
    const after = { ...before, key: toBase64(randomKey()) };
    projects[record.id] = await sealProject(newKey, record.id, generation, after);
    for (const secret of vault.secrets.filter((entry) => entry.projectId === record.id)) {
      const at = (gen: number) => ({
        projectId: record.id,
        generation: gen,
        environmentId: secret.environmentId,
        secretId: secret.id,
      });
      const content = await openSecret(before, at(current), secret.sealed);
      secrets[secret.id] = await sealSecret(after, at(generation), content);
    }
  }

  await request(`${teamPath(orgId, team.id)}/key`, {
    method: "PUT",
    body: json({ generation, wrappedKeys, projects, secrets }),
  });
}
