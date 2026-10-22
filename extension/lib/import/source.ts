import { parseTotpInput, type TotpConfig } from "../../../src/core/totp.js";
import { cleanCustomFields, type CustomField } from "../item-types.js";
import type { ItemDraft } from "../vault/types.js";

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

export type ImportFormat = "1pw" | "proton" | "bitwarden" | "1password" | "csv" | "recovery";

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

export function countSkip(skipped: ImportSource["skipped"], reason: SkipReason, count = 1): void {
  if (count > 0) {
    skipped[reason] = (skipped[reason] ?? 0) + count;
  }
}

export function cardExpiry(month: string, year: string): string | undefined {
  const m = Number(month);
  const digits = year.trim().slice(-2);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !/^\d{2}$/.test(digits)) {
    return undefined;
  }
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

export interface FieldEntry {
  label: string;
  value: string | undefined;
  hidden?: boolean;
}

export function customFields(entries: FieldEntry[]): CustomField[] | undefined {
  return cleanCustomFields(
    entries.flatMap(({ label, value, hidden }) =>
      value?.trim() ? [{ label, value: value.trim(), hidden }] : [],
    ),
  );
}
