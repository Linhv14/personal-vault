import type { AuditEvent } from "#core/org-model.js";
import { now } from "../clock.js";
import { chainHash, GENESIS, verifyChain } from "./audit-chain.js";

const AUDIT_PAGE = 100;

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
