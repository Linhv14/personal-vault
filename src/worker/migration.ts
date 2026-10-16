import { toBase64, fromBase64 } from "../core/bytes.js";

type Cell = string | number | null | { b64: string };
export type TableDump = { columns: string[]; rows: Cell[][] };
export type StoreDump = Record<string, TableDump>;

const SYSTEM_TABLE = /^(sqlite_|_cf_|__)/;

function encode(value: SqlStorageValue): Cell {
  if (value instanceof ArrayBuffer) return { b64: toBase64(new Uint8Array(value)) };
  return value as string | number | null;
}

function decode(value: Cell): SqlStorageValue {
  if (value !== null && typeof value === "object")
    return fromBase64(value.b64).buffer as ArrayBuffer;
  return value;
}

function tables(sql: SqlStorage): string[] {
  return sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((row) => row.name)
    .filter((name) => !SYSTEM_TABLE.test(name));
}

export function dumpStore(sql: SqlStorage): StoreDump {
  const dump: StoreDump = {};
  for (const table of tables(sql)) {
    const cursor = sql.exec(`SELECT * FROM "${table}"`);
    dump[table] = {
      columns: cursor.columnNames,
      rows: [...cursor.raw()].map((row) => row.map(encode)),
    };
  }
  return dump;
}

export function restoreStore(storage: DurableObjectStorage, dump: StoreDump): number {
  const sql = storage.sql;
  const known = new Set(tables(sql));
  for (const table of Object.keys(dump)) {
    if (!known.has(table)) throw new Error(`Unknown table ${table}`);
    const count = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`).one().n;
    if (count > 0) throw new Error(`Table ${table} is not empty`);
  }
  let rows = 0;
  storage.transactionSync(() => {
    for (const [table, { columns, rows: values }] of Object.entries(dump)) {
      const names = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(", ");
      const marks = columns.map(() => "?").join(", ");
      for (const row of values) {
        sql.exec(`INSERT INTO "${table}" (${names}) VALUES (${marks})`, ...row.map(decode));
        rows++;
      }
    }
  });
  return rows;
}
