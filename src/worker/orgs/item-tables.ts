import { isSealedData, type SealedData } from "../../core/crypto.js";
import { parseJsonAs } from "../../core/json.js";

export interface TeamItemRecord {
  id: string;
  sealed: SealedData;
  updatedAt: number;
  updatedBy: string;
}

type ItemRow = { id: string; sealed: string; updated_at: number; updated_by: string };

function itemRecord(row: ItemRow): TeamItemRecord {
  return {
    id: row.id,
    sealed: parseJsonAs(row.sealed, isSealedData),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export class ItemTables {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS team_items (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        sealed TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_items_team ON team_items (team_id);
    `);
  }

  ofTeam(teamId: string): TeamItemRecord[] {
    return this.sql
      .exec<ItemRow>(
        "SELECT id, sealed, updated_at, updated_by FROM team_items WHERE team_id = ? ORDER BY updated_at",
        teamId,
      )
      .toArray()
      .map(itemRecord);
  }

  teamOf(itemId: string): string | null {
    const row = this.sql
      .exec<{ team_id: string }>("SELECT team_id FROM team_items WHERE id = ?", itemId)
      .toArray()[0];
    return row?.team_id ?? null;
  }

  bytes(teamId: string, exceptId: string): number {
    return this.sql
      .exec<{ n: number }>(
        "SELECT coalesce(sum(length(sealed)), 0) AS n FROM team_items WHERE team_id = ? AND id != ?",
        teamId,
        exceptId,
      )
      .one().n;
  }

  count(teamId: string): number {
    return this.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM team_items WHERE team_id = ?", teamId)
      .one().n;
  }

  put(teamId: string, id: string, sealed: SealedData, by: string, at: number): void {
    this.sql.exec(
      `INSERT INTO team_items (id, team_id, sealed, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET sealed = excluded.sealed, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      id,
      teamId,
      JSON.stringify(sealed),
      by,
      at,
    );
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM team_items WHERE id = ?", id);
  }

  removeTeam(teamId: string): void {
    this.sql.exec("DELETE FROM team_items WHERE team_id = ?", teamId);
  }

  reseal(items: Record<string, SealedData>): void {
    for (const [id, sealed] of Object.entries(items)) {
      this.sql.exec("UPDATE team_items SET sealed = ? WHERE id = ?", JSON.stringify(sealed), id);
    }
  }
}
