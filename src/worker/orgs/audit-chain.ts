import { sha256 } from "#core/primitives.js";
import { toBase64, utf8Encode } from "#core/bytes.js";
import type { AuditEvent } from "#core/org-model.js";

export const GENESIS = "genesis";

export type AuditEntry = Omit<AuditEvent, "seq" | "hash">;

export function chainInput(previous: string, entry: AuditEntry): string {
  const { at, actor, action, target, ip } = entry;
  return `${previous}\n${JSON.stringify({ at, actor, action, target, ip })}`;
}

export async function chainHash(previous: string, entry: AuditEntry): Promise<string> {
  return toBase64(await sha256(utf8Encode(chainInput(previous, entry))));
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
