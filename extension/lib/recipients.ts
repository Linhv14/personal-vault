export const MAX_SHARE_RECIPIENTS = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RecipientUpdate {
  recipients: string[];
  rejected: string[];
  overflow: boolean;
}

export function addRecipients(current: readonly string[], raw: string): RecipientUpdate {
  const recipients = [...current];
  const rejected: string[] = [];
  let overflow = false;
  const entries = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of entries) {
    if (!EMAIL_PATTERN.test(entry)) rejected.push(entry);
    else if (recipients.includes(entry)) continue;
    else if (recipients.length >= MAX_SHARE_RECIPIENTS) overflow = true;
    else recipients.push(entry);
  }
  return { recipients, rejected, overflow };
}

export function singleViewAllowed(recipientCount: number): boolean {
  return recipientCount <= 1;
}
