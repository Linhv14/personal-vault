import type { OrgRole, TeamAccess, WrappedKey } from "#core/org-model.js";

export type TeamRow = { id: string; name: string; key_generation: number; rekey_needed: number };
export type MembershipRow = {
  team_id: string;
  account_id: string;
  wrapped_key: string;
  access: TeamAccess;
};
export type InviteRow = { email: string; team_id: string; access: TeamAccess };
export type GrantRow = { team_id: string; account_id: string; access: TeamAccess };
export type SharedTeamRow = TeamRow & { wrapped_key: string; access: TeamAccess };

export class TeamTables {
  constructor(private readonly sql: SqlStorage) {}

  role(accountId: string): OrgRole | null {
    const row = this.sql
      .exec<{ role: OrgRole }>("SELECT role FROM members WHERE account_id = ?", accountId)
      .toArray()[0];
    return row?.role ?? null;
  }

  putMember(accountId: string, role: OrgRole): void {
    this.sql.exec(
      "INSERT INTO members (account_id, role) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
      accountId,
      role,
    );
  }

  teamsOfAccount(accountId: string): string[] {
    return this.sql
      .exec<{ team_id: string }>("SELECT team_id FROM team_members WHERE account_id = ?", accountId)
      .toArray()
      .map((row) => row.team_id);
  }

  flagRekey(teamId: string): void {
    this.sql.exec("UPDATE teams SET rekey_needed = 1 WHERE id = ?", teamId);
  }

  removeAccount(accountId: string): void {
    this.sql.exec("DELETE FROM team_members WHERE account_id = ?", accountId);
    this.sql.exec("DELETE FROM members WHERE account_id = ?", accountId);
    this.sql.exec("DELETE FROM pending_grants WHERE account_id = ?", accountId);
  }

  transferOwnership(owner: string, successor: string): void {
    this.sql.exec("UPDATE members SET role = 'admin' WHERE account_id = ?", owner);
    this.sql.exec("UPDATE members SET role = 'owner' WHERE account_id = ?", successor);
  }

  replaceInvites(email: string, teams: { teamId: string; access: TeamAccess }[]): void {
    this.forgetInvites(email);
    for (const { teamId, access } of teams) {
      this.sql.exec(
        "INSERT INTO team_invites (email, team_id, access) VALUES (?, ?, ?)",
        email,
        teamId,
        access,
      );
    }
  }

  forgetInvites(email: string): void {
    this.sql.exec("DELETE FROM team_invites WHERE email = ?", email);
  }

  grantInvites(email: string, accountId: string): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO pending_grants (team_id, account_id, access)
         SELECT team_id, ?, access FROM team_invites
          WHERE email = ? AND team_id IN (SELECT id FROM teams)`,
      accountId,
      email,
    );
  }

  all(): TeamRow[] {
    return this.sql
      .exec<TeamRow>("SELECT id, name, key_generation, rekey_needed FROM teams ORDER BY created_at")
      .toArray();
  }

  memberships(): MembershipRow[] {
    return this.sql
      .exec<MembershipRow>("SELECT team_id, account_id, wrapped_key, access FROM team_members")
      .toArray();
  }

  invites(): InviteRow[] {
    return this.sql
      .exec<InviteRow>("SELECT email, team_id, access FROM team_invites ORDER BY email")
      .toArray();
  }

  grants(): GrantRow[] {
    return this.sql
      .exec<GrantRow>("SELECT team_id, account_id, access FROM pending_grants")
      .toArray();
  }

  sharedWith(accountId: string): SharedTeamRow[] {
    return this.sql
      .exec<SharedTeamRow>(
        `SELECT t.id, t.name, t.key_generation, t.rekey_needed, m.wrapped_key, m.access
           FROM teams t JOIN team_members m ON m.team_id = t.id
          WHERE m.account_id = ? ORDER BY t.created_at`,
        accountId,
      )
      .toArray();
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM teams").one().n;
  }

  generationOf(teamId: string): number | null {
    const row = this.sql
      .exec<{ key_generation: number }>("SELECT key_generation FROM teams WHERE id = ?", teamId)
      .toArray()[0];
    return row?.key_generation ?? null;
  }

  exists(teamId: string): boolean {
    return this.generationOf(teamId) !== null;
  }

  rekeyNeeded(teamId: string): boolean {
    return (
      this.sql
        .exec<{ rekey_needed: number }>("SELECT rekey_needed FROM teams WHERE id = ?", teamId)
        .one().rekey_needed === 1
    );
  }

  insert(
    team: { id: string; name: string; wrappedKey: WrappedKey },
    creator: string,
    at: number,
  ): void {
    this.sql.exec(
      "INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)",
      team.id,
      team.name,
      at,
    );
    this.sql.exec(
      "INSERT INTO team_members (team_id, account_id, wrapped_key, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
      team.id,
      creator,
      JSON.stringify(team.wrappedKey),
      creator,
      at,
    );
  }

  inTeam(teamId: string, accountId: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM team_members WHERE team_id = ? AND account_id = ?", teamId, accountId)
        .toArray().length > 0
    );
  }

  isViewer(teamId: string, accountId: string): boolean {
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

  members(teamId: string): string[] {
    return this.sql
      .exec<{ account_id: string }>("SELECT account_id FROM team_members WHERE team_id = ?", teamId)
      .toArray()
      .map((row) => row.account_id);
  }

  putMembership(
    teamId: string,
    member: { accountId: string; wrappedKey: WrappedKey; access?: TeamAccess },
    by: string,
    at: number,
  ): void {
    this.sql.exec(
      `INSERT INTO team_members (team_id, account_id, wrapped_key, added_by, added_at, access)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, account_id) DO UPDATE SET wrapped_key = excluded.wrapped_key,
         added_by = excluded.added_by, added_at = excluded.added_at,
         access = CASE WHEN ? IS NULL THEN team_members.access ELSE excluded.access END`,
      teamId,
      member.accountId,
      JSON.stringify(member.wrappedKey),
      by,
      at,
      member.access ?? "edit",
      member.access ?? null,
    );
    this.sql.exec(
      "DELETE FROM pending_grants WHERE team_id = ? AND account_id = ?",
      teamId,
      member.accountId,
    );
  }

  removeMembership(teamId: string, accountId: string): void {
    this.sql.exec(
      "DELETE FROM team_members WHERE team_id = ? AND account_id = ?",
      teamId,
      accountId,
    );
  }

  setAccess(teamId: string, accountId: string, access: TeamAccess): void {
    this.sql.exec(
      "UPDATE team_members SET access = ? WHERE team_id = ? AND account_id = ?",
      access,
      teamId,
      accountId,
    );
  }

  rekey(
    teamId: string,
    generation: number,
    members: string[],
    wrappedKeys: Record<string, WrappedKey>,
  ): void {
    for (const accountId of members) {
      this.sql.exec(
        "UPDATE team_members SET wrapped_key = ? WHERE team_id = ? AND account_id = ?",
        JSON.stringify(wrappedKeys[accountId]),
        teamId,
        accountId,
      );
    }
    this.sql.exec(
      "UPDATE teams SET key_generation = ?, rekey_needed = 0 WHERE id = ?",
      generation,
      teamId,
    );
  }

  remove(teamId: string): void {
    this.sql.exec("DELETE FROM team_members WHERE team_id = ?", teamId);
    this.sql.exec("DELETE FROM team_invites WHERE team_id = ?", teamId);
    this.sql.exec("DELETE FROM pending_grants WHERE team_id = ?", teamId);
    this.sql.exec("DELETE FROM teams WHERE id = ?", teamId);
  }
}
