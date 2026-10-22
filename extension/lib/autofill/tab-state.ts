export const PENDING_TTL_MS = 5 * 60_000;

export function pendingKey(tabId: number): string {
  return `autofill:pending:${tabId}`;
}

export function identifierKey(tabId: number): string {
  return `autofill:identifier:${tabId}`;
}

export function totpKey(tabId: number): string {
  return `autofill:totp:${tabId}`;
}

export async function forgetTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove([pendingKey(tabId), identifierKey(tabId), totpKey(tabId)]);
}
