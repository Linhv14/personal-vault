function addColumn(sql: SqlStorage, table: string, definition: string) {
  const column = definition.split(" ")[0];
  const columns = sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
    .toArray();
  if (!columns.some((entry) => entry.name === column)) {
    sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export function createOrgSchema(sql: SqlStorage): void {
  sql.exec(`
      CREATE TABLE IF NOT EXISTS members (account_id TEXT PRIMARY KEY, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rekey_needed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        wrapped_key TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS team_invites (
        email TEXT NOT NULL,
        team_id TEXT NOT NULL,
        access TEXT NOT NULL,
        PRIMARY KEY (email, team_id)
      );
      CREATE TABLE IF NOT EXISTS pending_grants (
        team_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        access TEXT NOT NULL,
        PRIMARY KEY (team_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        ip TEXT,
        hash TEXT NOT NULL
      );
    `);
  addColumn(sql, "teams", "key_generation INTEGER NOT NULL DEFAULT 0");
  addColumn(sql, "team_members", "access TEXT NOT NULL DEFAULT 'edit'");
}
