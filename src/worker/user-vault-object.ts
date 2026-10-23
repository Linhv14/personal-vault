import { DurableObject } from "cloudflare:workers";
import { now } from "./clock.js";
import { fail, ok, type Result } from "./result.js";
import { FileTables, ORPHAN_SECONDS, PENDING_SECONDS, personalFileKey } from "./file-tables.js";
import { dumpStore, restoreStore, type StoreDump } from "./migration.js";
import type { StoreEnv } from "./store-env.js";

export const MAX_ITEMS_PER_ACCOUNT = 5_000;
const UPDATED_AT_RESOLUTION_SECONDS = 1;

export interface StoredItem {
  id: string;
  ciphertext: string | null;
  nonce: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

type Row = {
  id: string;
  ciphertext: string;
  nonce: string;
  updated_at: number;
  deleted_at: number | null;
};

export class UserStore extends DurableObject<StoreEnv> {
  private readonly sql: SqlStorage;
  private readonly files: FileTables;

  constructor(ctx: DurableObjectState, env: StoreEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS items_updated ON items (updated_at);
    `);
    this.files = new FileTables(
      this.sql,
      "SELECT 1 FROM items i WHERE i.id = f.item_id AND i.deleted_at IS NULL",
    );
  }

  private meta(key: string): string | null {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private async open(accountId: string): Promise<boolean> {
    const owner = this.meta("owner");
    if (owner !== null) {
      return owner === accountId;
    }
    const { results } = await this.env.DB.prepare(
      "SELECT id, ciphertext, nonce, updated_at, deleted_at FROM items WHERE account_id = ?",
    )
      .bind(accountId)
      .all<Row>();
    this.ctx.storage.transactionSync(() => {
      for (const row of results) {
        this.sql.exec(
          "INSERT OR IGNORE INTO items (id, ciphertext, nonce, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)",
          row.id,
          row.ciphertext,
          row.nonce,
          row.updated_at,
          row.deleted_at,
        );
      }
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('owner', ?)", accountId);
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('imported', ?)", String(results.length));
    });
    return true;
  }

  private liveCount(): number {
    return this.sql
      .exec<{ live: number }>("SELECT count(*) AS live FROM items WHERE deleted_at IS NULL")
      .one().live;
  }

  async list(
    accountId: string,
    since: number,
  ): Promise<Result<{ serverTime: number; items: StoredItem[] }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    const serverTime = now();
    const rows = this.sql
      .exec<Row>(
        "SELECT id, ciphertext, nonce, updated_at, deleted_at FROM items WHERE updated_at > ? ORDER BY updated_at ASC",
        since,
      )
      .toArray();
    return ok({
      serverTime: serverTime - UPDATED_AT_RESOLUTION_SECONDS,
      items: rows.map((row) => ({
        id: row.id,
        ciphertext: row.deleted_at ? null : row.ciphertext,
        nonce: row.deleted_at ? null : row.nonce,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
      })),
    });
  }

  async put(
    accountId: string,
    id: string,
    sealed: { ciphertext: string; nonce: string },
    ifUpdatedAt?: number,
  ): Promise<Result<{ id: string; updatedAt: number }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    const updatedAt = now();
    if (ifUpdatedAt !== undefined) {
      const changed = this.sql.exec(
        `UPDATE items SET ciphertext = ?, nonce = ?, updated_at = ?
          WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`,
        sealed.ciphertext,
        sealed.nonce,
        updatedAt,
        id,
        ifUpdatedAt,
      ).rowsWritten;
      return changed ? ok({ id, updatedAt }) : fail(409, "items.conflict");
    }
    const existing = this.sql
      .exec("SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL", id)
      .toArray().length;
    if (!existing && this.liveCount() >= MAX_ITEMS_PER_ACCOUNT) {
      return fail(403, "items.quota_exceeded");
    }
    this.sql.exec(
      `INSERT INTO items (id, ciphertext, nonce, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce,
         updated_at = excluded.updated_at, deleted_at = NULL`,
      id,
      sealed.ciphertext,
      sealed.nonce,
      updatedAt,
    );
    return ok({ id, updatedAt });
  }

  async createMany(
    accountId: string,
    rows: { id: string; ciphertext: string; nonce: string }[],
  ): Promise<Result<{ updatedAt: number; created: string[] }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    if (this.liveCount() + rows.length > MAX_ITEMS_PER_ACCOUNT) {
      return fail(403, "items.quota_exceeded");
    }
    const updatedAt = now();
    const created: string[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        const written = this.sql.exec(
          `INSERT INTO items (id, ciphertext, nonce, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO NOTHING`,
          row.id,
          row.ciphertext,
          row.nonce,
          updatedAt,
        ).rowsWritten;
        if (written) {
          created.push(row.id);
        }
      }
    });
    return ok({ updatedAt, created });
  }

  async remove(accountId: string, id: string): Promise<Result<{ id: string; deletedAt: number }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    const deletedAt = now();
    const changed = this.sql.exec(
      `UPDATE items SET deleted_at = ?, updated_at = ?, ciphertext = '', nonce = ''
        WHERE id = ? AND deleted_at IS NULL`,
      deletedAt,
      deletedAt,
      id,
    ).rowsWritten;
    if (!changed) {
      return fail(404, "items.not_found");
    }
    try {
      await this.dropFiles(this.files.ofItem(id));
    } catch {
      await this.wakeAt(now() + ORPHAN_SECONDS + 1);
    }
    return ok({ id, deletedAt });
  }

  private async dropFiles(ids: string[]): Promise<void> {
    const owner = this.meta("owner");
    if (ids.length === 0 || owner === null) {
      return;
    }
    for (let start = 0; start < ids.length; start += 1000) {
      const batch = ids.slice(start, start + 1000);
      await this.env.FILES?.delete(batch.map((id) => personalFileKey(owner, id)));
      this.files.forget(batch);
    }
  }

  private async wakeAt(seconds: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > seconds * 1000) {
      await this.ctx.storage.setAlarm(seconds * 1000);
    }
  }

  async reserveFile(
    accountId: string,
    file: { id: string; itemId: string; size: number },
    limits: { accountBytes: number; perItem: number },
  ): Promise<Result<{ id: string }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    const reservation = this.files.reserve(file, limits, now());
    if (reservation !== "reserved") {
      return fail(reservation === "quota_exceeded" ? 403 : 409, `files.${reservation}`);
    }
    await this.wakeAt(now() + PENDING_SECONDS + 1);
    return ok({ id: file.id });
  }

  async confirmFile(accountId: string, id: string): Promise<void> {
    if (await this.open(accountId)) {
      this.files.confirm(id);
    }
  }

  async fileSize(accountId: string, id: string): Promise<number | null> {
    if (!(await this.open(accountId))) {
      return null;
    }
    return this.files.readySize(id);
  }

  async removeFile(accountId: string, id: string): Promise<Result<{ id: string }>> {
    if (!(await this.open(accountId))) {
      return fail(403, "items.forbidden");
    }
    if (!this.files.has(id)) {
      return fail(404, "files.not_found");
    }
    await this.dropFiles([id]);
    return ok({ id });
  }

  async alarm(): Promise<void> {
    const { due, next } = this.files.sweep(now());
    await this.dropFiles(due);
    if (next !== null) {
      await this.ctx.storage.setAlarm((next + 1) * 1000);
    }
  }

  async destroy(accountId: string): Promise<void> {
    const owner = this.meta("owner");
    if (owner !== null && owner !== accountId) {
      return;
    }
    await this.dropFiles(this.files.all());
    await this.ctx.storage.deleteAll();
  }

  async exportState(): Promise<StoreDump> {
    return dumpStore(this.sql);
  }

  async importState(dump: StoreDump): Promise<number> {
    return restoreStore(this.ctx.storage, dump);
  }
}
