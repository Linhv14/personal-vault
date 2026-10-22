import { isWrappedForRecipient } from "#core/identity.js";
import { parseJsonAs } from "#core/json.js";
import type { WrappedKey } from "#core/org-model.js";

export interface LinkRecord {
  id: string;
  projectId: string;
  environmentId: string;
  repository: string;
  branch: string | null;
  githubEnvironment: string | null;
  publicKey: string;
  wrappedKey: WrappedKey;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

type LinkRow = {
  id: string;
  team_id: string;
  project_id: string;
  environment_id: string;
  repository: string;
  branch: string | null;
  github_environment: string | null;
  public_key: string;
  wrapped_key: string;
  created_by: string;
  created_at: number;
  last_used_at: number | null;
};

function linkRecord(row: LinkRow): LinkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    repository: row.repository,
    branch: row.branch,
    githubEnvironment: row.github_environment,
    publicKey: row.public_key,
    wrappedKey: parseJsonAs(row.wrapped_key, isWrappedForRecipient),
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class LinkTables {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT,
        github_environment TEXT,
        public_key TEXT NOT NULL,
        wrapped_key TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_links_project ON links (project_id);
    `);
  }

  ofProject(projectId: string): LinkRecord[] {
    return this.sql
      .exec<LinkRow>("SELECT * FROM links WHERE project_id = ? ORDER BY created_at", projectId)
      .toArray()
      .map(linkRecord);
  }

  ofTeam(teamId: string): LinkRecord[] {
    return this.sql
      .exec<LinkRow>("SELECT * FROM links WHERE team_id = ?", teamId)
      .toArray()
      .map(linkRecord);
  }

  find(linkId: string): (LinkRecord & { teamId: string }) | null {
    const row = this.sql.exec<LinkRow>("SELECT * FROM links WHERE id = ?", linkId).toArray()[0];
    return row ? { ...linkRecord(row), teamId: row.team_id } : null;
  }

  count(projectId: string): number {
    return this.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM links WHERE project_id = ?", projectId)
      .one().n;
  }

  insert(teamId: string, link: Omit<LinkRecord, "lastUsedAt">): void {
    this.sql.exec(
      `INSERT INTO links (id, team_id, project_id, environment_id, repository, branch,
         github_environment, public_key, wrapped_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      link.id,
      teamId,
      link.projectId,
      link.environmentId,
      link.repository,
      link.branch,
      link.githubEnvironment,
      link.publicKey,
      JSON.stringify(link.wrappedKey),
      link.createdBy,
      link.createdAt,
    );
  }

  remove(linkId: string): void {
    this.sql.exec("DELETE FROM links WHERE id = ?", linkId);
  }

  removeProject(projectId: string): void {
    this.sql.exec("DELETE FROM links WHERE project_id = ?", projectId);
  }

  removeTeam(teamId: string): void {
    this.sql.exec("DELETE FROM links WHERE team_id = ?", teamId);
  }

  rewrap(wrapped: Record<string, WrappedKey>): void {
    for (const [id, key] of Object.entries(wrapped)) {
      this.sql.exec("UPDATE links SET wrapped_key = ? WHERE id = ?", JSON.stringify(key), id);
    }
  }

  touch(linkId: string, at: number): void {
    this.sql.exec("UPDATE links SET last_used_at = ? WHERE id = ?", at, linkId);
  }
}
