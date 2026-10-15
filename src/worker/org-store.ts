import { DurableObject } from "cloudflare:workers";
import { toBase64, utf8Encode } from "../core/bytes.js";
import type { Env } from "./types.js";

export type OrgRole = "owner" | "admin" | "member";

export interface Principal {
  accountId: string;
  role: OrgRole;
}

export interface WrappedKey {
  ephemeralPublicKey: string;
  sealed: { ciphertext: string; nonce: string };
}

export interface TeamView {
  id: string;
  name: string;
  members: string[];
  rekeyNeeded: boolean;
  wrappedKey: WrappedKey | null;
}

export type AuditEvent = {
  seq: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  hash: string;
};

export type OrgResult<T> =
  { ok: true; value: T } | { ok: false; status: 403 | 404 | 409; code: string };

const MAX_TEAMS = 200;
const AUDIT_PAGE = 100;
const GENESIS = "genesis";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function isAdmin(principal: Principal): boolean {
  return principal.role === "owner" || principal.role === "admin";
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

  async listTeams(principal: Principal): Promise<OrgResult<TeamView[]>> {
    if (!this.confirmed(principal)) return { ok: false, status: 403, code: "orgs.forbidden" };
    const teams = this.sql
      .exec<{ id: string; name: string; rekey_needed: number }>(
        "SELECT id, name, rekey_needed FROM teams ORDER BY created_at",
      )
      .toArray();
    const memberships = this.sql
      .exec<{ team_id: string; account_id: string; wrapped_key: string }>(
        "SELECT team_id, account_id, wrapped_key FROM team_members",
      )
      .toArray();
    const visible = teams.filter(
      (team) =>
        isAdmin(principal) ||
        memberships.some(
          (entry) => entry.team_id === team.id && entry.account_id === principal.accountId,
        ),
    );
    return {
      ok: true,
      value: visible.map((team) => {
        const members = memberships.filter((entry) => entry.team_id === team.id);
        const mine = members.find((entry) => entry.account_id === principal.accountId);
        return {
          id: team.id,
          name: team.name,
          members: members.map((entry) => entry.account_id),
          rekeyNeeded: team.rekey_needed === 1,
          wrappedKey: mine ? (JSON.parse(mine.wrapped_key) as WrappedKey) : null,
        };
      }),
    };
  }

  async createTeam(
    principal: Principal,
    team: { id: string; name: string; wrappedKey: WrappedKey },
    ip: string | null,
  ): Promise<OrgResult<{ id: string }>> {
    if (!this.confirmed(principal) || !isAdmin(principal)) {
      return { ok: false, status: 403, code: "orgs.forbidden" };
    }
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM teams").one().n;
    if (count >= MAX_TEAMS) return { ok: false, status: 409, code: "orgs.limit_reached" };
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
    return { ok: true, value: { id: team.id } };
  }

  private inTeam(teamId: string, accountId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM team_members WHERE team_id = ? AND account_id = ?", teamId, accountId)
        .toArray().length > 0
    );
  }

  private teamExists(teamId: string): boolean {
    return this.sql.exec("SELECT 1 FROM teams WHERE id = ?", teamId).toArray().length > 0;
  }

  async addTeamMember(
    principal: Principal,
    teamId: string,
    member: { accountId: string; wrappedKey: WrappedKey },
    ip: string | null,
  ): Promise<OrgResult<{ ok: true }>> {
    if (!this.confirmed(principal) || !isAdmin(principal)) {
      return { ok: false, status: 403, code: "orgs.forbidden" };
    }
    if (!this.teamExists(teamId)) return { ok: false, status: 404, code: "orgs.not_found" };
    if (!this.inTeam(teamId, principal.accountId)) {
      return { ok: false, status: 403, code: "orgs.not_in_team" };
    }
    if (!this.role(member.accountId)) return { ok: false, status: 404, code: "orgs.not_found" };
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
    return { ok: true, value: { ok: true } };
  }

  async removeTeamMember(
    principal: Principal,
    teamId: string,
    accountId: string,
    ip: string | null,
  ): Promise<OrgResult<{ ok: true }>> {
    if (!this.confirmed(principal) || !isAdmin(principal)) {
      return { ok: false, status: 403, code: "orgs.forbidden" };
    }
    if (!this.inTeam(teamId, accountId)) return { ok: false, status: 404, code: "orgs.not_found" };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "DELETE FROM team_members WHERE team_id = ? AND account_id = ?",
        teamId,
        accountId,
      );
      this.sql.exec("UPDATE teams SET rekey_needed = 1 WHERE id = ?", teamId);
    });
    await this.record(principal.accountId, "team.member_removed", `${teamId}:${accountId}`, ip);
    return { ok: true, value: { ok: true } };
  }

  async deleteTeam(
    principal: Principal,
    teamId: string,
    ip: string | null,
  ): Promise<OrgResult<{ ok: true }>> {
    if (!this.confirmed(principal) || !isAdmin(principal)) {
      return { ok: false, status: 403, code: "orgs.forbidden" };
    }
    if (!this.teamExists(teamId)) return { ok: false, status: 404, code: "orgs.not_found" };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM team_members WHERE team_id = ?", teamId);
      this.sql.exec("DELETE FROM teams WHERE id = ?", teamId);
    });
    await this.record(principal.accountId, "team.deleted", teamId, ip);
    return { ok: true, value: { ok: true } };
  }

  async audit(
    principal: Principal,
    before?: number,
  ): Promise<OrgResult<{ events: AuditEvent[]; verified: boolean }>> {
    if (!this.confirmed(principal) || !isAdmin(principal)) {
      return { ok: false, status: 403, code: "orgs.forbidden" };
    }
    const events = this.sql
      .exec<AuditEvent>(
        "SELECT seq, at, actor, action, target, ip, hash FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT ?",
        before ?? Number.MAX_SAFE_INTEGER,
        AUDIT_PAGE,
      )
      .toArray();
    return { ok: true, value: { events, verified: await this.verifyChain() } };
  }

  async verifyChain(): Promise<boolean> {
    let previous = GENESIS;
    for (const row of this.sql
      .exec<AuditEvent>("SELECT seq, at, actor, action, target, ip, hash FROM audit ORDER BY seq")
      .toArray()) {
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
