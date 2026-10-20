import { DurableObject } from "cloudflare:workers";
import { toBase64, utf8Encode } from "../../core/bytes.js";
import type { SealedData } from "../../core/crypto.js";
import { MAX_SECRETS_PER_PROJECT, type SecretAccess } from "../../core/projects.js";
import { MAX_TEAM_ITEMS, MAX_TEAM_VAULT_BYTES } from "../../core/team-items.js";
import {
  isOrgAdmin,
  type AuditEvent,
  type OrgRole,
  type Principal,
  type TeamAccess,
  type TeamView,
  type WrappedKey,
} from "../../core/org-model.js";
import { fail, now, ok, type Result } from "../http.js";
import { dumpStore, restoreStore, type StoreDump } from "../migration.js";
import type { Env } from "../types.js";
import { ruleAllows, type GithubClaims } from "../../core/ci.js";
import { LinkTables, type LinkRecord } from "./link-tables.js";
import { ItemTables, type TeamItemRecord } from "./item-tables.js";
import {
  ProjectTables,
  type ProjectRecord,
  type SecretRecord,
  type SecretVersionRecord,
} from "./project-tables.js";

const AUDIT_PAGE = 100;
const GENESIS = "genesis";
const MAX_LINKS_PER_PROJECT = 50;

function sameKeys(ids: string[], map: Record<string, unknown>): boolean {
  return ids.length === Object.keys(map).length && ids.every((id) => id in map);
}

async function chainHash(
  previous: string,
  event: Omit<AuditEvent, "seq" | "hash">,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8Encode(`${previous}\n${JSON.stringify(event)}`),
  );
  return toBase64(new Uint8Array(digest));
}

export class OrgStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly projects: ProjectTables;
  private readonly links: LinkTables;
  private readonly items: ItemTables;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (account_id TEXT PRIMARY KEY, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rekey_needed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        wrapped_key TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        ip TEXT,
        hash TEXT NOT NULL
      );
    `);
    this.addColumn("teams", "key_generation INTEGER NOT NULL DEFAULT 0");
    this.addColumn("team_members", "access TEXT NOT NULL DEFAULT 'edit'");
    this.projects = new ProjectTables(this.sql);
    this.links = new LinkTables(this.sql);
    this.items = new ItemTables(this.sql);
  }

  private addColumn(table: string, definition: string) {
    const column = definition.split(" ")[0];
    const columns = this.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
      .toArray();
    if (!columns.some((entry) => entry.name === column)) {
      this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }

  private role(accountId: string): OrgRole | null {
    const row = this.sql
      .exec<{ role: OrgRole }>("SELECT role FROM members WHERE account_id = ?", accountId)
      .toArray()[0];
    return row?.role ?? null;
  }

  private confirmed(principal: Principal): boolean {
    return this.role(principal.accountId) === principal.role;
  }

  private async record(actor: string, action: string, target: string | null, ip: string | null) {
    const previous =
      this.sql
        .exec<{ hash: string }>("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1")
        .toArray()[0]?.hash ?? GENESIS;
    const event = { at: now(), actor, action, target, ip };
    const hash = await chainHash(previous, event);
    this.sql.exec(
      "INSERT INTO audit (at, actor, action, target, ip, hash) VALUES (?, ?, ?, ?, ?, ?)",
      event.at,
      actor,
      action,
      target,
      ip,
      hash,
    );
  }

  async setMember(
    actor: string,
    member: { accountId: string; role: OrgRole },
    action: string,
    ip: string | null,
  ): Promise<void> {
    this.sql.exec(
      "INSERT INTO members (account_id, role) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
      member.accountId,
      member.role,
    );
    await this.record(actor, action, member.accountId, ip);
  }

  async removeMember(actor: string, accountId: string, ip: string | null): Promise<void> {
    const teams = this.sql
      .exec<{ team_id: string }>("SELECT team_id FROM team_members WHERE account_id = ?", accountId)
      .toArray();
    this.ctx.storage.transactionSync(() => {
      for (const { team_id } of teams) {
        this.sql.exec("UPDATE teams SET rekey_needed = 1 WHERE id = ?", team_id);
      }
      this.sql.exec("DELETE FROM team_members WHERE account_id = ?", accountId);
      this.sql.exec("DELETE FROM members WHERE account_id = ?", accountId);
    });
    await this.record(actor, "member.removed", accountId, ip);
  }

  async note(actor: string, action: string, target: string | null, ip: string | null) {
    await this.record(actor, action, target, ip);
  }

  async listTeams(principal: Principal): Promise<Result<TeamView[]>> {
    if (!this.confirmed(principal)) return fail(403, "orgs.forbidden");
    const teams = this.sql
      .exec<{ id: string; name: string; key_generation: number; rekey_needed: number }>(
        "SELECT id, name, key_generation, rekey_needed FROM teams ORDER BY created_at",
      )
      .toArray();
    const memberships = this.sql
      .exec<{ team_id: string; account_id: string; wrapped_key: string; access: TeamAccess }>(
        "SELECT team_id, account_id, wrapped_key, access FROM team_members",
      )
      .toArray();
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
          generation: team.key_generation,
          rekeyNeeded: team.rekey_needed === 1,
          wrappedKey: mine ? (JSON.parse(mine.wrapped_key) as WrappedKey) : null,
        };
      }),
    );
  }

  async overview(principal: Principal): Promise<
    Result<{
      teams: TeamView[];
      projects: Record<string, { generation: number; projects: ProjectRecord[] }>;
    }>
  > {
    const teams = await this.listTeams(principal);
    if (!teams.ok) return teams;
    const projects: Record<string, { generation: number; projects: ProjectRecord[] }> = {};
    for (const team of teams.value) {
      if (!team.wrappedKey) continue;
      const listed = await this.listProjects(principal, team.id);
      if (listed.ok) {
        projects[team.id] = {
          generation: listed.value.generation,
          projects: listed.value.projects,
        };
      }
    }
    return ok({ teams: teams.value, projects });
  }

  async createTeam(
    principal: Principal,
    team: { id: string; name: string; wrappedKey: WrappedKey },
    maxTeams: number,
    ip: string | null,
  ): Promise<Result<{ id: string }>> {
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM teams").one().n;
    if (count >= maxTeams) return fail(409, "orgs.team_limit", { limit: maxTeams });
    if (this.teamExists(team.id)) return fail(409, "orgs.invalid_team");
    const at = now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)",
        team.id,
        team.name,
        at,
      );
      this.sql.exec(
        "INSERT INTO team_members (team_id, account_id, wrapped_key, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
        team.id,
        principal.accountId,
        JSON.stringify(team.wrappedKey),
        principal.accountId,
        at,
      );
    });
    await this.record(principal.accountId, "team.created", team.id, ip);
    return ok({ id: team.id });
  }

  private inTeam(teamId: string, accountId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM team_members WHERE team_id = ? AND account_id = ?", teamId, accountId)
        .toArray().length > 0
    );
  }

  private teamExists(teamId: string): boolean {
    return this.generationOf(teamId) !== null;
  }

  private generationOf(teamId: string): number | null {
    const row = this.sql
      .exec<{ key_generation: number }>("SELECT key_generation FROM teams WHERE id = ?", teamId)
      .toArray()[0];
    return row?.key_generation ?? null;
  }

  private teamMembers(teamId: string): string[] {
    return this.sql
      .exec<{ account_id: string }>("SELECT account_id FROM team_members WHERE team_id = ?", teamId)
      .toArray()
      .map((row) => row.account_id);
  }

  async addTeamMember(
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
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    const generation = this.generationOf(teamId);
    if (generation === null) return fail(404, "orgs.not_found");
    if (!this.inTeam(teamId, principal.accountId)) {
      return fail(403, "orgs.not_in_team");
    }
    if (!this.role(member.accountId)) return fail(404, "orgs.not_found");
    if (member.generation !== generation) return fail(409, "orgs.stale_team_key");
    this.sql.exec(
      `INSERT INTO team_members (team_id, account_id, wrapped_key, added_by, added_at, access)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, account_id) DO UPDATE SET wrapped_key = excluded.wrapped_key,
         added_by = excluded.added_by, added_at = excluded.added_at,
         access = CASE WHEN ? IS NULL THEN team_members.access ELSE excluded.access END`,
      teamId,
      member.accountId,
      JSON.stringify(member.wrappedKey),
      principal.accountId,
      now(),
      member.access ?? "edit",
      member.access ?? null,
    );
    await this.record(
      principal.accountId,
      "team.member_added",
      `${teamId}:${member.accountId}`,
      ip,
    );
    return ok({ ok: true as const });
  }

  async removeTeamMember(
    principal: Principal,
    teamId: string,
    accountId: string,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    if (!this.inTeam(teamId, accountId)) return fail(404, "orgs.not_found");
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "DELETE FROM team_members WHERE team_id = ? AND account_id = ?",
        teamId,
        accountId,
      );
      this.sql.exec("UPDATE teams SET rekey_needed = 1 WHERE id = ?", teamId);
    });
    await this.record(principal.accountId, "team.member_removed", `${teamId}:${accountId}`, ip);
    return ok({ ok: true as const });
  }

  async rekeyTeam(
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
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    const generation = this.generationOf(teamId);
    if (generation === null) return fail(404, "orgs.not_found");
    if (!this.inTeam(teamId, principal.accountId)) return fail(403, "orgs.not_in_team");
    if (next.generation !== generation + 1) return fail(409, "orgs.stale_team_key");
    const members = this.teamMembers(teamId);
    const recipients = Object.keys(next.wrappedKeys);
    if (
      recipients.length !== members.length ||
      !members.every((accountId) => accountId in next.wrappedKeys)
    ) {
      return fail(409, "orgs.team_changed");
    }
    const projectIds = this.projects.ofTeam(teamId).map((project) => project.id);
    const secretIds = this.projects.secretsOfTeam(teamId).map((secret) => secret.id);
    const linkIds = this.links.ofTeam(teamId).map((link) => link.id);
    const itemIds = this.items.ofTeam(teamId).map((item) => item.id);
    const versionIds = this.projects.versionsOfTeam(teamId).map((version) => version.id);
    if (
      (next.versions !== undefined && !sameKeys(versionIds, next.versions)) ||
      !sameKeys(projectIds, next.projects) ||
      !sameKeys(secretIds, next.secrets) ||
      !sameKeys(linkIds, next.links) ||
      !sameKeys(itemIds, next.items)
    ) {
      return fail(409, "orgs.team_changed");
    }
    this.ctx.storage.transactionSync(() => {
      if (next.versions === undefined) this.projects.dropVersionsOfTeam(teamId);
      this.projects.reseal(next.projects, next.secrets, next.versions ?? {});
      this.links.rewrap(next.links);
      this.items.reseal(next.items);
      for (const accountId of members) {
        this.sql.exec(
          "UPDATE team_members SET wrapped_key = ? WHERE team_id = ? AND account_id = ?",
          JSON.stringify(next.wrappedKeys[accountId]),
          teamId,
          accountId,
        );
      }
      this.sql.exec(
        "UPDATE teams SET key_generation = ?, rekey_needed = 0 WHERE id = ?",
        next.generation,
        teamId,
      );
    });
    await this.record(principal.accountId, "team.rekeyed", teamId, ip);
    return ok({ generation: next.generation });
  }

  async transferOwnership(owner: string, successor: string, ip: string | null): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE members SET role = 'admin' WHERE account_id = ?", owner);
      this.sql.exec("UPDATE members SET role = 'owner' WHERE account_id = ?", successor);
    });
    await this.record(owner, "org.owner_transferred", successor, ip);
  }

  private teamAccess(
    principal: Principal,
    teamId: string,
    adminOnly: boolean,
  ): Result<{ generation: number; rekeyNeeded: boolean }> {
    if (!this.confirmed(principal)) return fail(403, "orgs.forbidden");
    if (adminOnly && !isOrgAdmin(principal.role)) return fail(403, "orgs.forbidden");
    const generation = this.generationOf(teamId);
    if (generation === null) return fail(404, "orgs.not_found");
    if (!this.inTeam(teamId, principal.accountId)) return fail(403, "orgs.not_in_team");
    const rekeyNeeded =
      this.sql
        .exec<{ rekey_needed: number }>("SELECT rekey_needed FROM teams WHERE id = ?", teamId)
        .one().rekey_needed === 1;
    return ok({ generation, rekeyNeeded });
  }

  private writable(access: { generation: number; rekeyNeeded: boolean }, generation: number) {
    if (access.rekeyNeeded) return fail<never>(409, "orgs.rekey_required");
    if (generation !== access.generation) return fail<never>(409, "orgs.stale_team_key");
    return null;
  }

  private projectAccess(
    principal: Principal,
    teamId: string,
    projectId: string,
    adminOnly: boolean,
  ): Result<{ generation: number; rekeyNeeded: boolean }> {
    const access = this.teamAccess(principal, teamId, adminOnly);
    if (!access.ok) return access;
    if (this.projects.teamOf(projectId) !== teamId) return fail(404, "orgs.not_found");
    return access;
  }

  private viewer(teamId: string, accountId: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM team_members WHERE team_id = ? AND account_id = ? AND access = 'view'",
          teamId,
          accountId,
        )
        .toArray().length > 0
    );
  }

  private refusedEdit(
    principal: Principal,
    teamId: string,
    projectId: string | null,
    environmentIds: Iterable<string>,
  ) {
    if (isOrgAdmin(principal.role)) return null;
    if (this.viewer(teamId, principal.accountId)) return fail<never>(403, "orgs.read_only");
    if (projectId === null) return null;
    for (const environmentId of environmentIds) {
      if (this.projects.isProtected(projectId, environmentId)) {
        return fail<never>(403, "orgs.protected_environment");
      }
    }
    return null;
  }

  async protectEnvironment(
    principal: Principal,
    teamId: string,
    projectId: string,
    environmentId: string,
    on: boolean,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const access = this.projectAccess(principal, teamId, projectId, true);
    if (!access.ok) return access;
    this.projects.protect(projectId, environmentId, on);
    await this.record(
      principal.accountId,
      on ? "environment.protected" : "environment.unprotected",
      `${projectId}:${environmentId}`,
      ip,
    );
    return ok({ ok: true as const });
  }

  async setTeamAccess(
    principal: Principal,
    teamId: string,
    accountId: string,
    access: TeamAccess,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    if (!this.inTeam(teamId, accountId)) return fail(404, "orgs.not_found");
    this.sql.exec(
      "UPDATE team_members SET access = ? WHERE team_id = ? AND account_id = ?",
      access,
      teamId,
      accountId,
    );
    await this.record(
      principal.accountId,
      access === "view" ? "team.member_view_only" : "team.member_can_edit",
      `${teamId}:${accountId}`,
      ip,
    );
    return ok({ ok: true as const });
  }

  async listProjects(
    principal: Principal,
    teamId: string,
  ): Promise<Result<{ generation: number; rekeyNeeded: boolean; projects: ProjectRecord[] }>> {
    const access = this.teamAccess(principal, teamId, false);
    if (!access.ok) return access;
    return ok({
      generation: access.value.generation,
      rekeyNeeded: access.value.rekeyNeeded,
      projects: this.projects.ofTeam(teamId),
    });
  }

  async createProject(
    principal: Principal,
    teamId: string,
    project: { id: string; sealed: SealedData; generation: number },
    maxProjects: number,
    ip: string | null,
  ): Promise<Result<{ id: string }>> {
    const access = this.teamAccess(principal, teamId, true);
    if (!access.ok) return access;
    const refused = this.writable(access.value, project.generation);
    if (refused) return refused;
    if (this.projects.teamOf(project.id) !== null) return fail(409, "orgs.invalid_project");
    if (this.projects.count() >= maxProjects) {
      return fail(409, "orgs.project_limit", { limit: maxProjects });
    }
    this.projects.insert(teamId, project.id, project.sealed, principal.accountId, now());
    await this.record(principal.accountId, "project.created", `${teamId}:${project.id}`, ip);
    return ok({ id: project.id });
  }

  async updateProject(
    principal: Principal,
    teamId: string,
    projectId: string,
    update: { sealed: SealedData; generation: number },
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const access = this.projectAccess(principal, teamId, projectId, true);
    if (!access.ok) return access;
    const refused = this.writable(access.value, update.generation);
    if (refused) return refused;
    this.projects.replace(projectId, update.sealed);
    await this.record(principal.accountId, "project.updated", `${teamId}:${projectId}`, ip);
    return ok({ ok: true as const });
  }

  async deleteProject(
    principal: Principal,
    teamId: string,
    projectId: string,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const access = this.projectAccess(principal, teamId, projectId, true);
    if (!access.ok) return access;
    this.ctx.storage.transactionSync(() => {
      this.links.removeProject(projectId);
      this.projects.remove(projectId);
    });
    await this.record(principal.accountId, "project.deleted", `${teamId}:${projectId}`, ip);
    return ok({ ok: true as const });
  }

  async noteSecretAccess(
    principal: Principal,
    teamId: string,
    projectId: string,
    events: { environmentId: string; access: SecretAccess }[],
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const allowed = this.projectAccess(principal, teamId, projectId, false);
    if (!allowed.ok) return allowed;
    for (const { environmentId, access } of events) {
      await this.record(
        principal.accountId,
        access === "exported" ? "secrets.exported" : `secret.${access}`,
        `${projectId}:${environmentId}`,
        ip,
      );
    }
    return ok({ ok: true as const });
  }

  async readSecrets(
    principal: Principal,
    teamId: string,
    projectId: string,
    environmentId: string,
    ip: string | null,
  ): Promise<Result<{ generation: number; secrets: SecretRecord[] }>> {
    const access = this.projectAccess(principal, teamId, projectId, false);
    if (!access.ok) return access;
    const secrets = this.projects.secrets(projectId, environmentId);
    await this.record(principal.accountId, "secrets.read", `${projectId}:${environmentId}`, ip);
    return ok({ generation: access.value.generation, secrets });
  }

  async secretVersions(
    principal: Principal,
    teamId: string,
    projectId: string,
    secretId: string,
    ip: string | null,
  ): Promise<
    Result<{ generation: number; environmentId: string; versions: SecretVersionRecord[] }>
  > {
    const access = this.projectAccess(principal, teamId, projectId, false);
    if (!access.ok) return access;
    const location = this.projects.secretLocation(secretId);
    if (location?.projectId !== projectId) return fail(404, "orgs.not_found");
    await this.record(
      principal.accountId,
      "secret.history_read",
      `${projectId}:${location.environmentId}`,
      ip,
    );
    return ok({
      generation: access.value.generation,
      environmentId: location.environmentId,
      versions: this.projects.versions(secretId),
    });
  }

  async writeSecrets(
    principal: Principal,
    teamId: string,
    projectId: string,
    batch: {
      generation: number;
      secrets: { id: string; environmentId: string; sealed: SealedData }[];
    },
    ip: string | null,
  ): Promise<Result<{ ids: string[] }>> {
    const access = this.projectAccess(principal, teamId, projectId, false);
    if (!access.ok) return access;
    const refused =
      this.writable(access.value, batch.generation) ??
      this.refusedEdit(
        principal,
        teamId,
        projectId,
        new Set(batch.secrets.map((secret) => secret.environmentId)),
      );
    if (refused) return refused;
    if (new Set(batch.secrets.map((secret) => secret.id)).size !== batch.secrets.length) {
      return fail(400, "orgs.invalid_secret");
    }
    let added = 0;
    for (const secret of batch.secrets) {
      const existing = this.projects.secretLocation(secret.id);
      if (!existing) added += 1;
      else if (
        existing.projectId !== projectId ||
        existing.environmentId !== secret.environmentId
      ) {
        return fail(409, "orgs.invalid_secret");
      }
    }
    if (this.projects.secretCount(projectId) + added > MAX_SECRETS_PER_PROJECT) {
      return fail(409, "orgs.secret_limit", { limit: MAX_SECRETS_PER_PROJECT });
    }
    const at = now();
    this.ctx.storage.transactionSync(() => {
      for (const secret of batch.secrets) {
        this.projects.putSecret({ ...secret, projectId }, principal.accountId, at);
      }
    });
    for (const environmentId of new Set(batch.secrets.map((secret) => secret.environmentId))) {
      await this.record(principal.accountId, "secret.written", `${projectId}:${environmentId}`, ip);
    }
    return ok({ ids: batch.secrets.map((secret) => secret.id) });
  }

  async deleteSecrets(
    principal: Principal,
    teamId: string,
    projectId: string,
    ids: string[],
    ip: string | null,
  ): Promise<Result<{ deleted: number }>> {
    const access = this.projectAccess(principal, teamId, projectId, false);
    if (!access.ok) return access;
    const found = ids
      .map((id) => ({ id, location: this.projects.secretLocation(id) }))
      .filter(({ location }) => location?.projectId === projectId);
    if (found.length === 0) return fail(404, "orgs.not_found");
    const refused = this.refusedEdit(
      principal,
      teamId,
      projectId,
      new Set(found.map(({ location }) => location!.environmentId)),
    );
    if (refused) return refused;
    this.ctx.storage.transactionSync(() => {
      for (const { id } of found) this.projects.deleteSecret(id);
    });
    for (const environmentId of new Set(found.map(({ location }) => location!.environmentId))) {
      await this.record(principal.accountId, "secret.deleted", `${projectId}:${environmentId}`, ip);
    }
    return ok({ deleted: found.length });
  }

  async listLinks(
    principal: Principal,
    teamId: string,
    projectId: string,
  ): Promise<Result<{ links: LinkRecord[] }>> {
    const access = this.projectAccess(principal, teamId, projectId, false);
    if (!access.ok) return access;
    return ok({ links: this.links.ofProject(projectId) });
  }

  async createLink(
    principal: Principal,
    teamId: string,
    projectId: string,
    link: Omit<LinkRecord, "createdBy" | "createdAt" | "lastUsedAt" | "projectId"> & {
      generation: number;
    },
    ip: string | null,
  ): Promise<Result<{ id: string }>> {
    const access = this.projectAccess(principal, teamId, projectId, true);
    if (!access.ok) return access;
    const refused = this.writable(access.value, link.generation);
    if (refused) return refused;
    if (this.links.find(link.id)) return fail(409, "orgs.invalid_link");
    if (this.links.count(projectId) >= MAX_LINKS_PER_PROJECT) {
      return fail(409, "orgs.link_limit", { limit: MAX_LINKS_PER_PROJECT });
    }
    const { generation: _generation, ...record } = link;
    this.links.insert(teamId, {
      ...record,
      projectId,
      createdBy: principal.accountId,
      createdAt: now(),
    });
    await this.record(
      principal.accountId,
      "link.created",
      `${projectId}:${link.environmentId}`,
      ip,
    );
    return ok({ id: link.id });
  }

  async deleteLink(
    principal: Principal,
    teamId: string,
    projectId: string,
    linkId: string,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const access = this.projectAccess(principal, teamId, projectId, true);
    if (!access.ok) return access;
    const link = this.links.find(linkId);
    if (!link || link.projectId !== projectId) return fail(404, "orgs.not_found");
    this.links.remove(linkId);
    await this.record(
      principal.accountId,
      "link.deleted",
      `${projectId}:${link.environmentId}`,
      ip,
    );
    return ok({ ok: true as const });
  }

  async ciRead(
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
    const link = this.links.find(linkId);
    if (!link || !ruleAllows(link, claims)) return fail(403, "ci.forbidden");
    const generation = this.generationOf(link.teamId);
    if (generation === null) return fail(403, "ci.forbidden");
    const secrets = this.projects
      .secrets(link.projectId, link.environmentId)
      .map(({ id, sealed }) => ({ id, sealed }));
    this.links.touch(linkId, now());
    await this.record(
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

  async teamVault(
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
    const access = this.teamAccess(principal, teamId, true);
    if (!access.ok) return access;
    const vault = {
      generation: access.value.generation,
      projects: this.projects.ofTeam(teamId),
      secrets: this.projects.secretsOfTeam(teamId),
      versions: this.projects.versionsOfTeam(teamId),
      links: this.links.ofTeam(teamId).map(({ id, projectId, environmentId, publicKey }) => ({
        id,
        projectId,
        environmentId,
        publicKey,
      })),
      items: this.items.ofTeam(teamId),
    };
    await this.record(principal.accountId, "team.vault_read", teamId, ip);
    return ok(vault);
  }

  async sharedVaults(principal: Principal): Promise<
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
    if (!this.confirmed(principal)) return fail(403, "orgs.forbidden");
    const rows = this.sql
      .exec<{
        id: string;
        name: string;
        key_generation: number;
        rekey_needed: number;
        wrapped_key: string;
        access: TeamAccess;
      }>(
        `SELECT t.id, t.name, t.key_generation, t.rekey_needed, m.wrapped_key, m.access
           FROM teams t JOIN team_members m ON m.team_id = t.id
          WHERE m.account_id = ? ORDER BY t.created_at`,
        principal.accountId,
      )
      .toArray();
    return ok(
      rows.map((row) => ({
        teamId: row.id,
        name: row.name,
        generation: row.key_generation,
        rekeyNeeded: row.rekey_needed === 1,
        viewOnly: row.access === "view" && !isOrgAdmin(principal.role),
        wrappedKey: JSON.parse(row.wrapped_key) as WrappedKey,
        items: this.items.ofTeam(row.id),
      })),
    );
  }

  async putTeamItem(
    principal: Principal,
    teamId: string,
    item: { id: string; sealed: SealedData; generation: number },
    ip: string | null,
  ): Promise<Result<{ updatedAt: number }>> {
    const access = this.teamAccess(principal, teamId, false);
    if (!access.ok) return access;
    const refused =
      this.writable(access.value, item.generation) ?? this.refusedEdit(principal, teamId, null, []);
    if (refused) return refused;
    const owner = this.items.teamOf(item.id);
    if (owner !== null && owner !== teamId) return fail(409, "orgs.invalid_item");
    if (owner === null && this.items.count(teamId) >= MAX_TEAM_ITEMS) {
      return fail(409, "orgs.item_limit", { limit: MAX_TEAM_ITEMS });
    }
    const size = JSON.stringify(item.sealed).length;
    if (this.items.bytes(teamId, item.id) + size > MAX_TEAM_VAULT_BYTES) {
      return fail(409, "orgs.vault_full", { megabytes: MAX_TEAM_VAULT_BYTES / 1024 / 1024 });
    }
    const updatedAt = now();
    this.items.put(teamId, item.id, item.sealed, principal.accountId, updatedAt);
    await this.record(principal.accountId, "team.item_saved", teamId, ip);
    return ok({ updatedAt });
  }

  async deleteTeamItem(
    principal: Principal,
    teamId: string,
    itemId: string,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    const access = this.teamAccess(principal, teamId, false);
    if (!access.ok) return access;
    if (this.items.teamOf(itemId) !== teamId) return fail(404, "orgs.not_found");
    const refused = this.refusedEdit(principal, teamId, null, []);
    if (refused) return refused;
    this.items.remove(itemId);
    await this.record(principal.accountId, "team.item_deleted", teamId, ip);
    return ok({ ok: true as const });
  }

  async deleteTeam(
    principal: Principal,
    teamId: string,
    ip: string | null,
  ): Promise<Result<{ ok: true }>> {
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    if (!this.teamExists(teamId)) return fail(404, "orgs.not_found");
    this.ctx.storage.transactionSync(() => {
      this.projects.removeTeam(teamId);
      this.links.removeTeam(teamId);
      this.items.removeTeam(teamId);
      this.sql.exec("DELETE FROM team_members WHERE team_id = ?", teamId);
      this.sql.exec("DELETE FROM teams WHERE id = ?", teamId);
    });
    await this.record(principal.accountId, "team.deleted", teamId, ip);
    return ok({ ok: true as const });
  }

  async audit(
    principal: Principal,
    before?: number,
  ): Promise<Result<{ events: AuditEvent[]; verified: boolean }>> {
    if (!this.confirmed(principal) || !isOrgAdmin(principal.role)) {
      return fail(403, "orgs.forbidden");
    }
    const events = this.sql
      .exec<AuditEvent>(
        "SELECT seq, at, actor, action, target, ip, hash FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT ?",
        before ?? Number.MAX_SAFE_INTEGER,
        AUDIT_PAGE,
      )
      .toArray();
    return ok({ events, verified: await this.verifyPage(events) });
  }

  private async verifyPage(events: AuditEvent[]): Promise<boolean> {
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const first = ordered[0];
    if (!first) return true;
    let previous =
      this.sql
        .exec<{ hash: string }>(
          "SELECT hash FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT 1",
          first.seq,
        )
        .toArray()[0]?.hash ?? GENESIS;
    for (const row of ordered) {
      const expected = await chainHash(previous, {
        at: row.at,
        actor: row.actor,
        action: row.action,
        target: row.target,
        ip: row.ip,
      });
      if (expected !== row.hash) return false;
      previous = row.hash;
    }
    return true;
  }

  async exportState(): Promise<StoreDump> {
    return dumpStore(this.sql);
  }

  async importState(dump: StoreDump): Promise<number> {
    return restoreStore(this.ctx.storage, dump);
  }
}
