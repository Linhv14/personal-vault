import type { InvitableRole, OrgRole } from "../../core/org-model.js";
import { now } from "../http.js";

export const MAX_ORGS_PER_ACCOUNT = 10;
export const MAX_MEMBERS_PER_ORG = 500;
export const INVITE_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface OrgSummary {
  id: string;
  name: string;
  plan: string;
  role: OrgRole;
}

export interface MemberRow {
  accountId: string;
  email: string;
  role: OrgRole;
  publicKey: string | null;
}

export interface InviteRow {
  id: string;
  email: string;
  role: InvitableRole;
  expiresAt: number;
}

export interface MyInviteRow {
  id: string;
  orgId: string;
  orgName: string;
  role: InvitableRole;
  expiresAt: number;
}

export class OrgDirectory {
  constructor(private readonly db: D1Database) {}

  async orgsOf(accountId: string): Promise<OrgSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT o.id, o.name, o.plan, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id
          WHERE m.account_id = ? ORDER BY o.name`,
      )
      .bind(accountId)
      .all<OrgSummary>();
    return results;
  }

  async ownedCount(accountId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT count(*) AS n FROM org_members WHERE account_id = ? AND role = 'owner'")
      .bind(accountId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async create(id: string, name: string, owner: string): Promise<void> {
    const at = now();
    await this.db.batch([
      this.db
        .prepare("INSERT INTO orgs (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, name, owner, at),
      this.db
        .prepare(
          "INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        )
        .bind(id, owner, at),
    ]);
  }

  async org(orgId: string): Promise<{ id: string; name: string; plan: string } | null> {
    return this.db
      .prepare("SELECT id, name, plan FROM orgs WHERE id = ?")
      .bind(orgId)
      .first<{ id: string; name: string; plan: string }>();
  }

  async roleOf(orgId: string, accountId: string): Promise<OrgRole | null> {
    const row = await this.db
      .prepare("SELECT role FROM org_members WHERE org_id = ? AND account_id = ?")
      .bind(orgId, accountId)
      .first<{ role: OrgRole }>();
    return row?.role ?? null;
  }

  async members(orgId: string): Promise<MemberRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.account_id AS accountId, a.email, m.role, a.public_key AS publicKey
           FROM org_members m JOIN accounts a ON a.id = m.account_id
          WHERE m.org_id = ?
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, a.email`,
      )
      .bind(orgId)
      .all<MemberRow>();
    return results;
  }

  async memberCount(orgId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT count(*) AS n FROM org_members WHERE org_id = ?")
      .bind(orgId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async hasMemberWithEmail(orgId: string, email: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 FROM org_members m JOIN accounts a ON a.id = m.account_id
          WHERE m.org_id = ? AND a.email = ?`,
      )
      .bind(orgId, email)
      .first();
    return row !== null;
  }

  async setRole(orgId: string, accountId: string, role: InvitableRole): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE org_members SET role = ? WHERE org_id = ? AND account_id = ? AND role != 'owner'",
      )
      .bind(role, orgId, accountId)
      .run();
    return result.meta.changes > 0;
  }

  async removeMember(orgId: string, accountId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM org_members WHERE org_id = ? AND account_id = ?")
      .bind(orgId, accountId)
      .run();
  }

  async orgIdsOf(accountId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT org_id FROM org_members WHERE account_id = ?")
      .bind(accountId)
      .all<{ org_id: string }>();
    return results.map((row) => row.org_id);
  }

  async invites(orgId: string): Promise<InviteRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, email, role, expires_at AS expiresAt FROM org_invites
          WHERE org_id = ? AND expires_at > ? ORDER BY created_at`,
      )
      .bind(orgId, now())
      .all<InviteRow>();
    return results;
  }

  async invite(orgId: string, email: string, role: InvitableRole, by: string): Promise<void> {
    const at = now();
    await this.db
      .prepare(
        `INSERT INTO org_invites (id, org_id, email, role, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(org_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by,
           created_at = excluded.created_at, expires_at = excluded.expires_at`,
      )
      .bind(crypto.randomUUID(), orgId, email, role, by, at, at + INVITE_TTL_SECONDS)
      .run();
  }

  async withdrawInvite(orgId: string, inviteId: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?")
      .bind(inviteId, orgId)
      .run();
  }

  async invitesFor(email: string): Promise<MyInviteRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT i.id, i.org_id AS orgId, o.name AS orgName, i.role, i.expires_at AS expiresAt
           FROM org_invites i JOIN orgs o ON o.id = i.org_id
          WHERE i.email = ? AND i.expires_at > ? ORDER BY i.created_at`,
      )
      .bind(email, now())
      .all<MyInviteRow>();
    return results;
  }

  async accept(inviteId: string, email: string, accountId: string): Promise<MyInviteRow | null> {
    const invite = await this.db
      .prepare(
        `SELECT i.id, i.org_id AS orgId, o.name AS orgName, i.role, i.expires_at AS expiresAt
           FROM org_invites i JOIN orgs o ON o.id = i.org_id
          WHERE i.id = ? AND i.email = ? AND i.expires_at > ?`,
      )
      .bind(inviteId, email, now())
      .first<MyInviteRow>();
    if (!invite) return null;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(org_id, account_id) DO NOTHING`,
        )
        .bind(invite.orgId, accountId, invite.role, now()),
      this.db.prepare("DELETE FROM org_invites WHERE id = ?").bind(invite.id),
    ]);
    return invite;
  }

  async decline(inviteId: string, email: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM org_invites WHERE id = ? AND email = ?")
      .bind(inviteId, email)
      .run();
  }

  async emailOf(accountId: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT email FROM accounts WHERE id = ?")
      .bind(accountId)
      .first<{ email: string }>();
    return row?.email ?? null;
  }
}
