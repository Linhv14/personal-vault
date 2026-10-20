import type { SealedData } from "../../core/crypto.js";

export interface ProjectRecord {
  id: string;
  sealed: SealedData;
  createdAt: number;
  secretCount: number;
  updatedAt: number;
  protectedEnvironments: string[];
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

export const MAX_SECRET_VERSIONS = 5;

export interface SecretVersionRecord {
  id: string;
  secretId: string;
  sealed: SealedData;
  updatedAt: number;
  updatedBy: string;
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
      CREATE TABLE IF NOT EXISTS secret_versions (
        id TEXT PRIMARY KEY,
        secret_id TEXT NOT NULL,
        sealed TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_secret_versions ON secret_versions (secret_id, updated_at);
      CREATE TABLE IF NOT EXISTS project_readers (
        project_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (project_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS protected_environments (
        project_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        PRIMARY KEY (project_id, environment_id)
      );
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
    const guarded = new Map<string, string[]>();
    for (const row of this.sql
      .exec<{ project_id: string; environment_id: string }>(
        `SELECT g.project_id, g.environment_id FROM protected_environments g
           JOIN projects p ON p.id = g.project_id WHERE p.team_id = ?`,
        teamId,
      )
      .toArray()) {
      guarded.set(row.project_id, [...(guarded.get(row.project_id) ?? []), row.environment_id]);
    }
    return this.sql
      .exec<{
        id: string;
        sealed: string;
        created_at: number;
        secret_count: number;
        updated_at: number | null;
      }>(
        `SELECT p.id, p.sealed, p.created_at, count(s.id) AS secret_count, max(s.updated_at) AS updated_at
           FROM projects p LEFT JOIN secrets s ON s.project_id = p.id
          WHERE p.team_id = ? GROUP BY p.id ORDER BY p.created_at`,
        teamId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        sealed: JSON.parse(row.sealed) as SealedData,
        createdAt: row.created_at,
        secretCount: row.secret_count,
        updatedAt: Math.max(row.updated_at ?? 0, row.created_at),
        protectedEnvironments: guarded.get(row.id) ?? [],
      }));
  }

  isProtected(projectId: string, environmentId: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM protected_environments WHERE project_id = ? AND environment_id = ?",
          projectId,
          environmentId,
        )
        .toArray().length > 0
    );
  }

  protect(projectId: string, environmentId: string, on: boolean): void {
    if (on) {
      this.sql.exec(
        "INSERT OR IGNORE INTO protected_environments (project_id, environment_id) VALUES (?, ?)",
        projectId,
        environmentId,
      );
    } else {
      this.sql.exec(
        "DELETE FROM protected_environments WHERE project_id = ? AND environment_id = ?",
        projectId,
        environmentId,
      );
    }
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
    this.sql.exec(
      "DELETE FROM secret_versions WHERE secret_id IN (SELECT id FROM secrets WHERE project_id = ?)",
      id,
    );
    this.sql.exec("DELETE FROM secrets WHERE project_id = ?", id);
    this.sql.exec("DELETE FROM protected_environments WHERE project_id = ?", id);
    this.sql.exec("DELETE FROM projects WHERE id = ?", id);
  }

  removeTeam(teamId: string): void {
    this.dropVersionsOfTeam(teamId);
    this.sql.exec(
      "DELETE FROM secrets WHERE project_id IN (SELECT id FROM projects WHERE team_id = ?)",
      teamId,
    );
    this.sql.exec(
      "DELETE FROM protected_environments WHERE project_id IN (SELECT id FROM projects WHERE team_id = ?)",
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
    const previous = this.sql
      .exec<{ sealed: string; updated_by: string; updated_at: number }>(
        "SELECT sealed, updated_by, updated_at FROM secrets WHERE id = ?",
        secret.id,
      )
      .toArray()[0];
    if (previous) {
      this.sql.exec(
        "INSERT INTO secret_versions (id, secret_id, sealed, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)",
        crypto.randomUUID(),
        secret.id,
        previous.sealed,
        previous.updated_by,
        previous.updated_at,
      );
      this.sql.exec(
        `DELETE FROM secret_versions WHERE secret_id = ? AND id NOT IN (
           SELECT id FROM secret_versions WHERE secret_id = ? ORDER BY updated_at DESC LIMIT ?)`,
        secret.id,
        secret.id,
        MAX_SECRET_VERSIONS,
      );
    }
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
    this.sql.exec("DELETE FROM secret_versions WHERE secret_id = ?", id);
    this.sql.exec("DELETE FROM secrets WHERE id = ?", id);
  }

  versions(secretId: string): SecretVersionRecord[] {
    return this.sql
      .exec<{ id: string; sealed: string; updated_by: string; updated_at: number }>(
        "SELECT id, sealed, updated_by, updated_at FROM secret_versions WHERE secret_id = ? ORDER BY updated_at DESC",
        secretId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        secretId,
        sealed: JSON.parse(row.sealed) as SealedData,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      }));
  }

  versionsOfTeam(teamId: string): { id: string; secretId: string; sealed: SealedData }[] {
    return this.sql
      .exec<{ id: string; secret_id: string; sealed: string }>(
        `SELECT v.id, v.secret_id, v.sealed FROM secret_versions v
           JOIN secrets s ON s.id = v.secret_id
           JOIN projects p ON p.id = s.project_id
          WHERE p.team_id = ?`,
        teamId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        secretId: row.secret_id,
        sealed: JSON.parse(row.sealed) as SealedData,
      }));
  }

  dropVersionsOfTeam(teamId: string): void {
    this.sql.exec(
      `DELETE FROM secret_versions WHERE secret_id IN (
         SELECT s.id FROM secrets s JOIN projects p ON p.id = s.project_id WHERE p.team_id = ?)`,
      teamId,
    );
  }

  reseal(
    projects: Record<string, SealedData>,
    secrets: Record<string, SealedData>,
    versions: Record<string, SealedData>,
  ): void {
    for (const [id, sealed] of Object.entries(projects)) this.replace(id, sealed);
    for (const [id, sealed] of Object.entries(secrets)) {
      this.sql.exec("UPDATE secrets SET sealed = ? WHERE id = ?", JSON.stringify(sealed), id);
    }
    for (const [id, sealed] of Object.entries(versions)) {
      this.sql.exec(
        "UPDATE secret_versions SET sealed = ? WHERE id = ?",
        JSON.stringify(sealed),
        id,
      );
    }
  }
}
