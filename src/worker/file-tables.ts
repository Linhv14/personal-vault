export const ORPHAN_SECONDS = 24 * 60 * 60;
export const PENDING_SECONDS = 60 * 60;

export function personalFileKey(accountId: string, fileId: string): string {
  return `a/${accountId}/${fileId}`;
}

export type Reservation = "reserved" | "exists" | "item_limit" | "quota_exceeded";

type SweepRow = { id: string; created_at: number; ready: number; live: number };

export class FileTables {
  constructor(
    private readonly sql: SqlStorage,
    private readonly liveItem: string,
  ) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS files_item ON files (item_id);
    `);
  }

  reserve(
    file: { id: string; itemId: string; size: number },
    limits: { accountBytes: number; perItem: number },
    createdAt: number,
  ): Reservation {
    if (this.sql.exec("SELECT 1 FROM files WHERE id = ?", file.id).toArray().length) {
      return "exists";
    }
    const onItem = this.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM files WHERE item_id = ?", file.itemId)
      .one().count;
    if (onItem >= limits.perItem) {
      return "item_limit";
    }
    const used = this.sql
      .exec<{ used: number }>("SELECT COALESCE(SUM(size), 0) AS used FROM files")
      .one().used;
    if (used + file.size > limits.accountBytes) {
      return "quota_exceeded";
    }
    this.sql.exec(
      "INSERT INTO files (id, item_id, size, created_at) VALUES (?, ?, ?, ?)",
      file.id,
      file.itemId,
      file.size,
      createdAt,
    );
    return "reserved";
  }

  confirm(id: string): void {
    this.sql.exec("UPDATE files SET ready = 1 WHERE id = ?", id);
  }

  has(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM files WHERE id = ?", id).toArray().length > 0;
  }

  readySize(id: string): number | null {
    const row = this.sql
      .exec<{ size: number }>("SELECT size FROM files WHERE id = ? AND ready = 1", id)
      .toArray()[0];
    return row?.size ?? null;
  }

  ofItem(itemId: string): string[] {
    return this.sql
      .exec<{ id: string }>("SELECT id FROM files WHERE item_id = ?", itemId)
      .toArray()
      .map((row) => row.id);
  }

  all(): string[] {
    return this.sql
      .exec<{ id: string }>("SELECT id FROM files")
      .toArray()
      .map((row) => row.id);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) {
      this.sql.exec("DELETE FROM files WHERE id = ?", id);
    }
  }

  sweep(time: number): { due: string[]; next: number | null } {
    const deadline = (row: SweepRow) =>
      row.created_at + (row.ready ? ORPHAN_SECONDS : PENDING_SECONDS);
    const waiting = this.sql
      .exec<SweepRow>(
        `SELECT f.id, f.created_at, f.ready, EXISTS (${this.liveItem}) AS live FROM files f`,
      )
      .toArray()
      .filter((row) => !row.ready || !row.live);
    const later = waiting.filter((row) => deadline(row) > time).map(deadline);
    return {
      due: waiting.filter((row) => deadline(row) <= time).map((row) => row.id),
      next: later.length > 0 ? Math.min(...later) : null,
    };
  }
}
