import type { SealedData } from "../../core/crypto.js";

export interface ProjectRecord {
  id: string;
  sealed: SealedData;
  createdAt: number;
}

export interface SecretRecord {
  id: string;
  projectId: string;
  environmentId: string;
  sealed: SealedData;
  updatedAt: number;
  updatedBy: string;
}

type SecretRow = {
  id: string;
  project_id: string;
  environment_id: string;
  sealed: string;
  updated_at: number;
  updated_by: string;
};

const SECRET_COLUMNS = "id, project_id, environment_id, sealed, updated_at, updated_by";

function secretRecord(row: SecretRow): SecretRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    sealed: JSON.parse(row.sealed) as SealedData,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export class ProjectTables {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        sealed TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_team ON projects (team_id);
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        sealed TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_secrets_project ON secrets (project_id, environment_id);
    `);
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM projects").one().n;
  }

  teamOf(projectId: string): string | null {
    const row = this.sql
      .exec<{ team_id: string }>("SELECT team_id FROM projects WHERE id = ?", projectId)
      .toArray()[0];
    return row?.team_id ?? null;
  }

  ofTeam(teamId: string): ProjectRecord[] {
    return this.sql
      .exec<{ id: string; sealed: string; created_at: number }>(
        "SELECT id, sealed, created_at FROM projects WHERE team_id = ? ORDER BY created_at",
        teamId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        sealed: JSON.parse(row.sealed) as SealedData,
        createdAt: row.created_at,
      }));
  }

  insert(teamId: string, id: string, sealed: SealedData, by: string, at: number): void {
    this.sql.exec(
      "INSERT INTO projects (id, team_id, sealed, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      teamId,
      JSON.stringify(sealed),
      by,
      at,
    );
  }

  replace(id: string, sealed: SealedData): void {
    this.sql.exec("UPDATE projects SET sealed = ? WHERE id = ?", JSON.stringify(sealed), id);
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM secrets WHERE project_id = ?", id);
    this.sql.exec("DELETE FROM projects WHERE id = ?", id);
  }

  removeTeam(teamId: string): void {
    this.sql.exec(
      "DELETE FROM secrets WHERE project_id IN (SELECT id FROM projects WHERE team_id = ?)",
      teamId,
    );
    this.sql.exec("DELETE FROM projects WHERE team_id = ?", teamId);
  }

  secrets(projectId: string, environmentId: string): SecretRecord[] {
    return this.sql
      .exec<SecretRow>(
        `SELECT ${SECRET_COLUMNS} FROM secrets WHERE project_id = ? AND environment_id = ? ORDER BY updated_at`,
        projectId,
        environmentId,
      )
      .toArray()
      .map(secretRecord);
  }

  secretsOfTeam(teamId: string): SecretRecord[] {
    return this.sql
      .exec<SecretRow>(
        `SELECT ${SECRET_COLUMNS} FROM secrets
          WHERE project_id IN (SELECT id FROM projects WHERE team_id = ?)`,
        teamId,
      )
      .toArray()
      .map(secretRecord);
  }

  secretCount(projectId: string): number {
    return this.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM secrets WHERE project_id = ?", projectId)
      .one().n;
  }

  secretLocation(secretId: string): { projectId: string; environmentId: string } | null {
    const row = this.sql
      .exec<{ project_id: string; environment_id: string }>(
        "SELECT project_id, environment_id FROM secrets WHERE id = ?",
        secretId,
      )
      .toArray()[0];
    return row ? { projectId: row.project_id, environmentId: row.environment_id } : null;
  }

  putSecret(
    secret: { id: string; projectId: string; environmentId: string; sealed: SealedData },
    by: string,
    at: number,
  ): void {
    this.sql.exec(
      `INSERT INTO secrets (id, project_id, environment_id, sealed, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET sealed = excluded.sealed, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      secret.id,
      secret.projectId,
      secret.environmentId,
      JSON.stringify(secret.sealed),
      by,
      at,
    );
  }

  deleteSecret(id: string): void {
    this.sql.exec("DELETE FROM secrets WHERE id = ?", id);
  }

  reseal(projects: Record<string, SealedData>, secrets: Record<string, SealedData>): void {
    for (const [id, sealed] of Object.entries(projects)) this.replace(id, sealed);
    for (const [id, sealed] of Object.entries(secrets)) {
      this.sql.exec("UPDATE secrets SET sealed = ? WHERE id = ?", JSON.stringify(sealed), id);
    }
  }
}
