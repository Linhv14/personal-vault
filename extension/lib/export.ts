import { pbkdf2AesKey } from "#core/primitives.js";
import { openJson, sealJson, type SealedData } from "#core/crypto.js";
import { fromBase64, randomBytes, toBase64, utf8Encode, type Bytes } from "#core/bytes.js";
import { buildOtpauthUri } from "#core/totp.js";
import { itemType } from "./item-types.js";
import type { ItemDraft, VaultItem } from "./vault/types.js";

export const EXPORT_FORMAT = "1pw-export";
export const EXPORT_ITERATIONS = 600_000;
export const EXPORT_PASSPHRASE_MIN = 10;
const MAX_ITERATIONS = 10_000_000;
const EXPORT_CONTEXT = utf8Encode("personal-vault/export/v1");

export interface EncryptedExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  kdf: { type: "pbkdf2-sha256"; iterations: number; salt: string };
  sealed: SealedData;
}

export class ExportPassphraseError extends Error {
  constructor() {
    super("wrong export passphrase");
    this.name = "ExportPassphraseError";
  }
}

async function exportKey(passphrase: string, salt: Bytes, iterations: number) {
  return pbkdf2AesKey(utf8Encode(passphrase), salt, iterations);
}

export function exportDrafts(items: VaultItem[]): ItemDraft[] {
  return items
    .filter((item) => !item.trashedAt && !item.system)
    .map((item) => {
      const {
        id: _id,
        updatedAt: _updatedAt,
        vault: _vault,
        system: _system,
        vaults: _vaults,
        trashedAt: _trashedAt,
        ...draft
      } = item;
      return draft;
    });
}

export async function encryptExport(
  items: VaultItem[],
  passphrase: string,
  iterations = EXPORT_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await exportKey(passphrase, salt, iterations);
  const file: EncryptedExport = {
    format: EXPORT_FORMAT,
    version: 1,
    kdf: { type: "pbkdf2-sha256", iterations, salt: toBase64(salt) },
    sealed: await sealJson(key, { items: exportDrafts(items) }, EXPORT_CONTEXT),
  };
  return JSON.stringify(file);
}

export function isEncryptedExport(value: unknown): value is EncryptedExport {
  const file = value as Partial<EncryptedExport> | null;
  return (
    typeof file === "object" &&
    file !== null &&
    file.format === EXPORT_FORMAT &&
    file.version === 1 &&
    file.kdf?.type === "pbkdf2-sha256" &&
    Number.isInteger(file.kdf.iterations) &&
    file.kdf.iterations > 0 &&
    file.kdf.iterations <= MAX_ITERATIONS &&
    typeof file.kdf.salt === "string" &&
    typeof file.sealed?.ciphertext === "string" &&
    typeof file.sealed.nonce === "string"
  );
}

export async function decryptExport(file: EncryptedExport, passphrase: string) {
  const key = await exportKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations);
  try {
    const { items } = await openJson<{ items: ItemDraft[] }>(key, file.sealed, EXPORT_CONTEXT);
    return Array.isArray(items) ? items : [];
  } catch {
    throw new ExportPassphraseError();
  }
}

const CSV_COLUMNS = ["name", "url", "username", "password", "note", "totp"] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvExport(items: VaultItem[]): { csv: string; exported: number; left: number } {
  const live = items.filter((item) => !item.trashedAt && !item.system);
  const logins = live.filter((item) => itemType(item) === "login");
  const rows = logins.map((item) =>
    [
      item.title,
      item.url ?? "",
      item.username ?? "",
      item.password ?? "",
      item.note ?? "",
      item.totp ? buildOtpauthUri(item.totp) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return {
    csv: [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n",
    exported: logins.length,
    left: live.length - logins.length,
  };
}
