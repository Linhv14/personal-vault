import { request } from "./api.js";

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: number | null;
  backupCodesLeft: number;
}

export function twoFactorStatus(): Promise<TwoFactorStatus> {
  return request<TwoFactorStatus>("/api/account/2fa");
}

export function startTwoFactor(currentAuthKey: string): Promise<{ secret: string; uri: string }> {
  return request("/api/account/2fa/setup", {
    method: "POST",
    body: JSON.stringify({ currentAuthKey }),
  });
}

export function enableTwoFactor(
  currentAuthKey: string,
  code: string,
  locale: string,
): Promise<{ enabledAt: number; backupCodes: string[] }> {
  return request("/api/account/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ currentAuthKey, code, locale }),
  });
}

export async function disableTwoFactor(
  currentAuthKey: string,
  code: string,
  locale: string,
): Promise<void> {
  await request("/api/account/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ currentAuthKey, code, locale }),
  });
}

export async function replaceBackupCodes(currentAuthKey: string, code: string): Promise<string[]> {
  const { backupCodes } = await request<{ backupCodes: string[] }>(
    "/api/account/2fa/backup-codes",
    { method: "POST", body: JSON.stringify({ currentAuthKey, code }) },
  );
  return backupCodes;
}

export function backupCodesText(details: {
  email: string;
  server: string;
  codes: string[];
  createdAt: number;
}): string {
  return [
    "7key backup codes",
    "",
    `Account: ${details.email}`,
    `Server: ${details.server}`,
    `Created: ${new Date(details.createdAt * 1000).toISOString().slice(0, 10)}`,
    "",
    ...details.codes,
    "",
    "Each code signs you in once when your authenticator app is not at hand.",
    "",
  ].join("\n");
}
