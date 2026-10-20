import { readdirSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

type Value = string | number | null;

interface Result {
  success: true;
  results: Record<string, unknown>[];
  meta: { changes: number };
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly log: string[],
    private readonly gate: (sql: string) => Promise<void>,
    readonly sql: string,
    private readonly params: Value[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    const values = params.map((value) =>
      value === undefined ? null : typeof value === "boolean" ? Number(value) : (value as Value),
    );
    return new Statement(this.db, this.log, this.gate, this.sql, values);
  }

  execute(): Result {
    this.log.push(this.sql);
    const statement = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      const rows = statement.all(...this.params).map((row) => ({ ...row }));
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const outcome = statement.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(outcome.changes) } };
  }

  async first(column?: string): Promise<unknown> {
    await this.gate(this.sql);
    const row = this.execute().results[0] ?? null;
    return column ? (row?.[column] ?? null) : row;
  }

  async run(): Promise<Result> {
    await this.gate(this.sql);
    return this.execute();
  }

  async all(): Promise<Result> {
    await this.gate(this.sql);
    return this.execute();
  }
}

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const log: string[] = [];
  const gates: { pattern: RegExp; opened: Promise<void> }[] = [];
  const gate = async (sql: string) => {
    for (const held of gates) if (held.pattern.test(sql)) await held.opened;
  };
  return {
    db,
    log,
    hold(pattern: RegExp): () => void {
      let release = () => {};
      const opened = new Promise<void>((resolve) => (release = resolve));
      gates.push({ pattern, opened });
      return release;
    },
    binding: {
      prepare: (sql: string) => new Statement(db, log, gate, sql),
      async batch(statements: Statement[]) {
        db.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.execute());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      async exec(sql: string) {
        db.exec(sql);
      },
    },
  };
}

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

export const REGISTRATION_TOKEN = "test-registration-token";
const WORKER_ENTRY: string = new URL("../src/worker/index.ts", import.meta.url).href;

function polyfillWorkerCrypto(): void {
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (subtle.timingSafeEqual) return;
  subtle.timingSafeEqual = (a, b) =>
    a.byteLength === b.byteLength && timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export async function startWorker({ mailer = false, vars = {} as Record<string, string> } = {}) {
  polyfillWorkerCrypto();
  const { default: worker } = (await import(WORKER_ENTRY)) as {
    default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
  };
  const d1 = createD1();
  const mail: SentEmail[] = [];
  const allow = { limit: async () => ({ success: true }) };
  const env = {
    DB: d1.binding,
    ASSETS: {
      fetch: async () =>
        new Response("<!doctype html><title>{{origin}}</title>", {
          headers: { "Content-Type": "text/html" },
        }),
    },
    ANONYMOUS_RATE_LIMITER: allow,
    REGISTRATION_RATE_LIMITER: allow,
    ACCOUNT_RATE_LIMITER: allow,
    REGISTRATION_MODE: "token",
    REGISTRATION_TOKEN,
    EMAIL_PROBE_SECRET: "test-probe-secret",
    AT_REST_SECRET: "test-at-rest-secret",
    ...(mailer
      ? {
          EMAIL_FROM: "vault@example.test",
          EMAIL: {
            send: async (message: SentEmail) => {
              mail.push({ to: message.to, subject: message.subject, text: message.text });
            },
          },
        }
      : {}),
    ...vars,
  };
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
    passThroughOnException: () => {},
    props: {},
  };

  async function fetch(
    path: string,
    init: RequestInit & { json?: unknown; token?: string; ip?: string; ua?: string } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set("Content-Type", "application/json");
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.1");
    if (init.ua) headers.set("User-Agent", init.ua);
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
    const url = path.startsWith("http") ? path : `https://vault.test${path}`;
    return worker.fetch(new Request(url, { ...init, headers, body }), env, ctx);
  }

  async function settle(): Promise<void> {
    while (pending.length) await Promise.all(pending.splice(0));
  }

  return { env, d1, mail, pending, fetch, settle };
}

export type TestWorker = Awaited<ReturnType<typeof startWorker>>;
