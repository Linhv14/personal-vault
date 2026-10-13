import { parseTotpInput, type TotpConfig } from "../../../src/core/totp.js";
import type { ItemDraft } from "../vault.js";

export type ImportErrorCode =
  | "needs_passphrase"
  | "wrong_passphrase"
  | "unsupported_encryption"
  | "account_encrypted"
  | "argon2"
  | "unrecognized"
  | "damaged";

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = "ImportError";
  }
}

export type SkipReason = "duplicate" | "trashed" | "alias" | "other" | "passkey";

export type ImportFormat = "proton" | "bitwarden" | "1password" | "csv" | "recovery";

export interface ImportSource {
  format: ImportFormat;
  drafts: ItemDraft[];
  skipped: Partial<Record<SkipReason, number>>;
}

export type JsonObject = Record<string, unknown>;

export function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

export function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function joinNote(parts: (string | false | undefined)[]): string | undefined {
  const note = parts.filter((part): part is string => Boolean(part && part.trim())).join("\n\n");
  return note || undefined;
}

export function lines(pairs: [string, string | undefined][]): string {
  return pairs
    .flatMap(([label, value]) => (value?.trim() ? [`${label}: ${value.trim()}`] : []))
    .join("\n");
}

export function countSkip(skipped: ImportSource["skipped"], reason: SkipReason, count = 1): void {
  if (count > 0) skipped[reason] = (skipped[reason] ?? 0) + count;
}

export function cardExpiry(month: string, year: string): string | undefined {
  const m = Number(month);
  const digits = year.trim().slice(-2);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !/^\d{2}$/.test(digits)) return undefined;
  return `${String(m).padStart(2, "0")}/${digits}`;
}

export function firstTotp(
  candidates: string[],
  title: string,
): { totp: TotpConfig | undefined; unreadable: string[] } {
  const present = candidates.map((candidate) => candidate.trim()).filter(Boolean);
  for (const candidate of present) {
    try {
      return { totp: parseTotpInput(candidate, title), unreadable: [] };
    } catch {
      continue;
    }
  }
  return { totp: undefined, unreadable: present };
}
