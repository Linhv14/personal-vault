import { DurableObject } from "cloudflare:workers";
import { toBase64, utf8Encode } from "../../core/bytes.js";
import type { SealedData } from "../../core/crypto.js";
import { MAX_SECRETS_PER_PROJECT, type SecretAccess } from "../../core/projects.js";
import {
  isOrgAdmin,
  type AuditEvent,
  type OrgRole,
  type Principal,
  type TeamView,
  type WrappedKey,
} from "../../core/org-model.js";
import { fail, now, ok, type Result } from "../http.js";
import type { Env } from "../types.js";
import { ProjectTables, type ProjectRecord, type SecretRecord } from "./project-tables.js";

const AUDIT_PAGE = 100;
const GENESIS = "genesis";

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
    this.projects = new ProjectTables(this.sql);
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
      .exec<{ team_id: string; account_id: string; wrapped_key: string }>(
        "SELECT team_id, account_id, wrapped_key FROM team_members",
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
          generation: team.key_generation,
          rekeyNeeded: team.rekey_needed === 1,
          wrappedKey: mine ? (JSON.parse(mine.wrapped_key) as WrappedKey) : null,
        };
      }),
    );
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
    member: { accountId: string; wrappedKey: WrappedKey; generation: number },
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
      `INSERT INTO team_members (team_id, account_id, wrapped_key, added_by, added_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team_id, account_id) DO UPDATE SET wrapped_key = excluded.wrapped_key,
         added_by = excluded.added_by, added_at = excluded.added_at`,
      teamId,
      member.accountId,
      JSON.stringify(member.wrappedKey),
      principal.accountId,
      now(),
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
    if (!sameKeys(projectIds, next.projects) || !sameKeys(secretIds, next.secrets)) {
      return fail(409, "orgs.team_changed");
    }
    this.ctx.storage.transactionSync(() => {
      this.projects.reseal(next.projects, next.secrets);
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
    this.ctx.storage.transactionSync(() => this.projects.remove(projectId));
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
    const refused = this.writable(access.value, batch.generation);
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
    this.ctx.storage.transactionSync(() => {
      for (const { id } of found) this.projects.deleteSecret(id);
    });
    for (const environmentId of new Set(found.map(({ location }) => location!.environmentId))) {
      await this.record(principal.accountId, "secret.deleted", `${projectId}:${environmentId}`, ip);
    }
    return ok({ deleted: found.length });
  }

  async teamVault(
    principal: Principal,
    teamId: string,
    ip: string | null,
  ): Promise<Result<{ generation: number; projects: ProjectRecord[]; secrets: SecretRecord[] }>> {
    const access = this.teamAccess(principal, teamId, true);
    if (!access.ok) return access;
    const vault = {
      generation: access.value.generation,
      projects: this.projects.ofTeam(teamId),
      secrets: this.projects.secretsOfTeam(teamId),
    };
    await this.record(principal.accountId, "team.vault_read", teamId, ip);
    return ok(vault);
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
}
