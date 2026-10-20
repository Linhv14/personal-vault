export const MASTER_PASSWORD_MIN_LENGTH = 12;
export const MASTER_PASSWORD_MAX_LENGTH = 256;

export type MasterPasswordIssue =
  | { code: "too_short"; min: number }
  | { code: "too_long"; max: number }
  | { code: "matches_email" }
  | { code: "breached"; count: number };

export type BreachLookup = (password: string) => Promise<number>;

export function masterPasswordLength(password: string): number {
  return [...password.normalize("NFC")].length;
}

function emailForms(email: string): string[] {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  const at = normalized.lastIndexOf("@");
  return at > 0 ? [normalized, normalized.slice(0, at)] : [normalized];
}

export function masterPasswordIssue(password: string, email: string): MasterPasswordIssue | null {
  const length = masterPasswordLength(password);
  if (length < MASTER_PASSWORD_MIN_LENGTH) {
    return { code: "too_short", min: MASTER_PASSWORD_MIN_LENGTH };
  }
  if (length > MASTER_PASSWORD_MAX_LENGTH) {
    return { code: "too_long", max: MASTER_PASSWORD_MAX_LENGTH };
  }
  if (emailForms(email).includes(password.trim().toLowerCase())) {
    return { code: "matches_email" };
  }
  return null;
}

export async function checkMasterPassword(
  password: string,
  email: string,
  breachLookup: BreachLookup,
): Promise<MasterPasswordIssue | null> {
  const issue = masterPasswordIssue(password, email);
  if (issue) return issue;
  let count: number;
  try {
    count = await breachLookup(password);
  } catch {
    return null;
  }
  return count > 0 ? { code: "breached", count } : null;
}
