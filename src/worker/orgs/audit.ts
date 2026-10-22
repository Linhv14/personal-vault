import { toBase64, utf8Encode } from "../../core/bytes.js";
import type { AuditEvent } from "../../core/org-model.js";
import { now } from "../http.js";

export const GENESIS = "genesis";
const AUDIT_PAGE = 100;

export type AuditEntry = Omit<AuditEvent, "seq" | "hash">;

export function chainInput(previous: string, entry: AuditEntry): string {
  const { at, actor, action, target, ip } = entry;
  return `${previous}\n${JSON.stringify({ at, actor, action, target, ip })}`;
}

export async function chainHash(previous: string, entry: AuditEntry): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(chainInput(previous, entry)));
  return toBase64(new Uint8Array(digest));
}

export async function verifyChain(previous: string, events: AuditEvent[]): Promise<boolean> {
  let hash = previous;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if ((await chainHash(hash, event)) !== event.hash) {
      return false;
    }
    hash = event.hash;
  }
  return true;
}

export class AuditLog {
  constructor(private readonly sql: SqlStorage) {}

  private hashBefore(seq: number): string {
    return (
      this.sql
        .exec<{ hash: string }>(
          "SELECT hash FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT 1",
          seq,
        )
        .toArray()[0]?.hash ?? GENESIS
    );
  }

  async record(
    actor: string,
    action: string,
    target: string | null,
    ip: string | null,
  ): Promise<void> {
    const previous =
      this.sql
        .exec<{ hash: string }>("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1")
        .toArray()[0]?.hash ?? GENESIS;
    const at = now();
    const hash = await chainHash(previous, { at, actor, action, target, ip });
    this.sql.exec(
      "INSERT INTO audit (at, actor, action, target, ip, hash) VALUES (?, ?, ?, ?, ?, ?)",
      at,
      actor,
      action,
      target,
      ip,
      hash,
    );
  }

  page(before?: number): AuditEvent[] {
    return this.sql
      .exec<AuditEvent>(
        "SELECT seq, at, actor, action, target, ip, hash FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT ?",
        before ?? Number.MAX_SAFE_INTEGER,
        AUDIT_PAGE,
      )
      .toArray();
  }

  async verify(events: AuditEvent[]): Promise<boolean> {
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const first = ordered[0];
    if (!first) {
      return true;
    }
    return verifyChain(this.hashBefore(first.seq), ordered);
  }
}
