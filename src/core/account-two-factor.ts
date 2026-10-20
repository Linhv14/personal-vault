import { randomInt } from "./generator.js";

export const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export type SecondFactor = { kind: "totp"; code: string } | { kind: "backup"; code: string };

export function generateBackupCode(): string {
  let code = "";
  for (let index = 0; index < BACKUP_CODE_LENGTH; index++) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return formatBackupCode(code);
}

export function formatBackupCode(code: string): string {
  const half = BACKUP_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

export function parseSecondFactor(input: unknown): SecondFactor | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const compact = input.replace(/[\s-]/g, "").toLowerCase();
  if (/^\d{6}$/.test(compact)) return { kind: "totp", code: compact };
  if (compact.length !== BACKUP_CODE_LENGTH) return null;
  for (const char of compact) if (!BACKUP_CODE_ALPHABET.includes(char)) return null;
  return { kind: "backup", code: compact };
}

export function groupSecret(secret: string, size = 4): string {
  return (secret.match(new RegExp(`.{1,${size}}`, "g")) ?? []).join(" ");
}
