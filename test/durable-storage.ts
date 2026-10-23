import { DatabaseSync } from "node:sqlite";

type Value = string | number | null;

function cursor(rows: Record<string, unknown>[], rowsWritten: number) {
  return {
    rowsWritten,
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) {
        throw new Error(`Expected one row, got ${rows.length}`);
      }
      return rows[0];
    },
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

export function durableState() {
  const db = new DatabaseSync(":memory:");
  let alarm: number | null = null;
  const sql = {
    exec(query: string, ...params: unknown[]) {
      if (params.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
        db.exec(query);
        return cursor([], 0);
      }
      const statement = db.prepare(query);
      const values = params.map((value) =>
        typeof value === "boolean" ? Number(value) : (value as Value),
      );
      if (/^\s*(SELECT|WITH)\b/i.test(query) || /\bRETURNING\b/i.test(query)) {
        const rows = statement.all(...values).map((row) => ({ ...row }));
        return cursor(rows, /\bRETURNING\b/i.test(query) ? rows.length : 0);
      }
      const outcome = statement.run(...values);
      return cursor([], Number(outcome.changes));
    },
  };
  const storage = {
    sql,
    transactionSync<T>(work: () => T): T {
      db.exec("BEGIN");
      try {
        const result = work();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async deleteAll() {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      for (const { name } of tables) {
        db.exec(`DROP TABLE "${name}"`);
      }
      alarm = null;
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(time: number | Date) {
      alarm = typeof time === "number" ? time : time.getTime();
    },
    async deleteAlarm() {
      alarm = null;
    },
  };
  return { storage, db, alarmAt: () => alarm };
}

export function durableNamespace<T>(create: (state: ReturnType<typeof durableState>) => T) {
  const instances = new Map<string, { object: T; state: ReturnType<typeof durableState> }>();
  const instance = (name: string) => {
    let entry = instances.get(name);
    if (!entry) {
      const state = durableState();
      entry = { object: create(state), state };
      instances.set(name, entry);
    }
    return entry;
  };
  return {
    binding: {
      idFromName: (name: string) => name,
      get: (name: string) => instance(name).object,
    },
    state: (name: string) => instance(name).state,
  };
}
