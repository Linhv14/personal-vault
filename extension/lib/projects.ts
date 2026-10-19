import type { SealedData } from "../../src/core/crypto.js";
import { openTeamItem, sealTeamItem } from "../../src/core/team-items.js";
import {
  createIdentity,
  wrapForRecipient,
  randomKey,
  type Identity,
} from "../../src/core/identity.js";
import { encodeRepoKey, linkKeyContext, linkReference } from "../../src/core/ci.js";
import { teamKeyContext, type WrappedKey } from "../../src/core/org-model.js";
import {
  environmentKey,
  newProject,
  openProject,
  openSecret,
  openSecretWithOrigin,
  sealProject,
  sealSecret,
  type ProjectContent,
  type SecretAccess,
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
  legacy: boolean;
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
  return openProjects(
    team,
    await request<{ generation: number; projects: ProjectRecord[] }>(
      `${teamPath(orgId, team.id)}/projects`,
    ),
    me,
  );
}

export async function openProjects(
  team: Team,
  { generation, projects }: { generation: number; projects: ProjectRecord[] },
  me: Identity,
): Promise<Project[]> {
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
    secrets.map(async (record) => {
      const { content, legacy } = await openSecretWithOrigin(
        project.content,
        address(project, environmentId, record.id),
        record.sealed,
      );
      return {
        ...content,
        id: record.id,
        environmentId,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        legacy,
      };
    }),
  );
  return opened.sort((a, b) => a.name.localeCompare(b.name));
}

export async function upgradeLegacySecrets(
  orgId: string,
  project: Project,
  secrets: Secret[],
): Promise<number> {
  const legacy = secrets.filter((secret) => secret.legacy);
  if (legacy.length === 0) return 0;
  await saveSecrets(
    orgId,
    project,
    legacy.map(({ id, environmentId, name, value, note, kind }) => ({
      id,
      environmentId,
      name,
      value,
      note,
      kind,
    })),
  );
  return legacy.length;
}

const BATCH = 500;

export interface SecretWrite extends SecretContent {
  id?: string;
  environmentId: string;
}

function chunks<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  );
}

export async function saveSecrets(
  orgId: string,
  project: Project,
  writes: SecretWrite[],
): Promise<void> {
  const sealed = await Promise.all(
    writes.map(
      async ({ id = crypto.randomUUID(), environmentId, name, value, note, kind, hosts }) => {
        const content: SecretContent = { name, value };
        if (note) content.note = note;
        if (kind === "variable") content.kind = kind;
        else if (hosts && hosts.length > 0) content.hosts = hosts;
        return {
          id,
          environmentId,
          sealed: await sealSecret(project.content, address(project, environmentId, id), content),
        };
      },
    ),
  );
  for (const batch of chunks(sealed, BATCH)) {
    await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/secrets`, {
      method: "POST",
      body: json({ generation: project.generation, secrets: batch }),
    });
  }
}

export async function saveSecret(
  orgId: string,
  project: Project,
  environmentId: string,
  secret: SecretContent & { id?: string },
): Promise<void> {
  await saveSecrets(orgId, project, [{ ...secret, environmentId }]);
}

export async function importSecrets(
  orgId: string,
  project: Project,
  environmentId: string,
  existing: Secret[],
  entries: SecretContent[],
): Promise<number> {
  await saveSecrets(
    orgId,
    project,
    entries.map((entry) => {
      const same = existing.find((secret) => secret.name === entry.name);
      return { hosts: same?.hosts, ...entry, environmentId, id: same?.id };
    }),
  );
  return entries.length;
}

const ACCESS_FLUSH_MS = 3000;
const accessQueue = new Map<
  string,
  { orgId: string; project: Project; events: { environmentId: string; access: SecretAccess }[] }
>();
const accessSeen = new Set<string>();
let accessTimer: ReturnType<typeof setTimeout> | undefined;

export function noteAccess(
  orgId: string,
  project: Project,
  environmentId: string,
  access: SecretAccess,
  secretId = "",
): void {
  const once = `${project.id}:${environmentId}:${access}:${secretId}`;
  if (accessSeen.has(once)) return;
  accessSeen.add(once);
  const key = `${orgId}:${project.id}`;
  const entry = accessQueue.get(key) ?? { orgId, project, events: [] };
  entry.events.push({ environmentId, access });
  accessQueue.set(key, entry);
  clearTimeout(accessTimer);
  accessTimer = setTimeout(() => void flushAccess(), ACCESS_FLUSH_MS);
}

export async function flushAccess(keepalive = false): Promise<void> {
  clearTimeout(accessTimer);
  const pending = [...accessQueue.values()];
  accessQueue.clear();
  await Promise.all(
    pending.map(({ orgId, project, events }) =>
      request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/access`, {
        method: "POST",
        keepalive,
        body: json({ events }),
      }).catch(() => {}),
    ),
  );
}

export async function deleteSecrets(
  orgId: string,
  project: Project,
  secretIds: string[],
): Promise<void> {
  for (const batch of chunks(secretIds, BATCH * 2)) {
    await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/secrets/delete`, {
      method: "POST",
      body: json({ ids: batch }),
    });
  }
}

export async function deleteSecret(
  orgId: string,
  project: Project,
  secretId: string,
): Promise<void> {
  await deleteSecrets(orgId, project, [secretId]);
}

export interface RepoLink {
  id: string;
  environmentId: string;
  repository: string;
  branch: string | null;
  githubEnvironment: string | null;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface NewLink {
  environmentId: string;
  repository: string;
  branch: string | null;
  githubEnvironment: string | null;
}

export async function listLinks(orgId: string, project: Project): Promise<RepoLink[]> {
  return (
    await request<{ links: RepoLink[] }>(
      `${teamPath(orgId, project.teamId)}/projects/${project.id}/links`,
    )
  ).links;
}

export async function createLink(
  orgId: string,
  project: Project,
  rule: NewLink,
): Promise<{ reference: string; repoKey: string }> {
  const id = crypto.randomUUID();
  const repo = await createIdentity();
  const wrappedKey = await wrapForRecipient(
    repo.publicKey,
    await environmentKey(project.content, project.id, rule.environmentId),
    linkKeyContext(id, project.generation),
  );
  await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/links`, {
    method: "POST",
    body: json({
      id,
      ...rule,
      publicKey: repo.publicKey,
      wrappedKey,
      generation: project.generation,
    }),
  });
  return { reference: linkReference(orgId, id), repoKey: encodeRepoKey(repo) };
}

export async function deleteLink(orgId: string, project: Project, linkId: string): Promise<void> {
  await request(`${teamPath(orgId, project.teamId)}/projects/${project.id}/links/${linkId}`, {
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
    links: { id: string; projectId: string; environmentId: string; publicKey: string }[];
    items?: { id: string; sealed: SealedData }[];
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
  const links: Record<string, WrappedKey> = {};
  for (const record of vault.projects) {
    const before = await openProject(oldKey, record.id, current, record.sealed);
    const after = { ...before, key: toBase64(randomKey()) };
    projects[record.id] = await sealProject(newKey, record.id, generation, after);
    for (const link of vault.links.filter((entry) => entry.projectId === record.id)) {
      links[link.id] = await wrapForRecipient(
        link.publicKey,
        await environmentKey(after, record.id, link.environmentId),
        linkKeyContext(link.id, generation),
      );
    }
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

  const items: Record<string, SealedData> = {};
  for (const record of vault.items ?? []) {
    const content = await openTeamItem(
      oldKey,
      { teamId: team.id, generation: current, itemId: record.id },
      record.sealed,
    );
    items[record.id] = await sealTeamItem(
      newKey,
      { teamId: team.id, generation, itemId: record.id },
      content,
    );
  }

  await request(`${teamPath(orgId, team.id)}/key`, {
    method: "PUT",
    body: json({ generation, wrappedKeys, projects, secrets, links, items }),
  });
}
