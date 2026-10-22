import type { Bytes } from "../../src/core/bytes.js";
import { isSealedData, rewrapVaultKey } from "../../src/core/crypto.js";
import {
  generateRecoveryCode,
  openWithRecovery,
  recoveryAuthKey,
  sealForRecovery,
} from "../../src/core/recovery.js";
import { ApiError, hasField, isNumber, request, requestChecked } from "./api.js";
import { assertMasterPasswordPolicy } from "./master-password.js";

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export async function recoveryCreatedAt(): Promise<number | null> {
  const { createdAt } = await requestChecked(
    "/api/account/recovery",
    hasField("createdAt", (value): value is number | null => value === null || isNumber(value)),
  );
  return createdAt;
}

export async function createRecoveryCode(
  currentAuthKey: string,
  vaultKeyRaw: Bytes,
): Promise<{ code: string; createdAt: number }> {
  const code = generateRecoveryCode();
  const material = await sealForRecovery(code, vaultKeyRaw);
  const { createdAt } = await requestChecked(
    "/api/account/recovery",
    hasField("createdAt", isNumber),
    {
      method: "PUT",
      body: JSON.stringify({ currentAuthKey, ...material }),
    },
  );
  return { code, createdAt };
}

export async function removeRecoveryCode(currentAuthKey: string): Promise<void> {
  await request("/api/account/recovery", {
    method: "DELETE",
    body: JSON.stringify({ currentAuthKey }),
  });
}

export async function requestRecoveryEmail(
  email: string,
  code: string,
  locale: string,
): Promise<boolean> {
  const { required } = await requestChecked(
    "/api/auth/recover/email",
    hasField("required", isBoolean),
    {
      method: "POST",
      auth: false,
      humanCheck: true,
      body: JSON.stringify({ email, recoveryAuthKey: await recoveryAuthKey(code), locale }),
    },
  );
  return required;
}

export async function recoverAccount(
  email: string,
  code: string,
  newPassword: string,
  locale: string,
  emailCode?: string,
): Promise<{ code: string; twoFactorDisabled: boolean }> {
  assertMasterPasswordPolicy(newPassword, email);
  const authKey = await recoveryAuthKey(code);
  const { wrappedVaultKey } = await requestChecked(
    "/api/auth/recover/start",
    hasField("wrappedVaultKey", isSealedData),
    {
      method: "POST",
      auth: false,
      humanCheck: true,
      body: JSON.stringify({ email, recoveryAuthKey: authKey, emailCode }),
    },
  );
  let vaultKeyRaw;
  try {
    vaultKeyRaw = await openWithRecovery(code, wrappedVaultKey);
  } catch {
    throw new ApiError("error.auth.invalid_recovery_code", 401);
  }
  const nextCode = generateRecoveryCode();
  const [record, recovery] = await Promise.all([
    rewrapVaultKey(email, newPassword, vaultKeyRaw),
    sealForRecovery(nextCode, vaultKeyRaw),
  ]);
  const finished = await request<{ twoFactorDisabled?: boolean }>("/api/auth/recover/finish", {
    method: "POST",
    auth: false,
    body: JSON.stringify({
      email,
      recoveryAuthKey: authKey,
      emailCode,
      ...record,
      recovery,
      locale,
    }),
  });
  return { code: nextCode, twoFactorDisabled: finished?.twoFactorDisabled === true };
}

export function recoveryKitText(details: {
  email: string;
  server: string;
  code: string;
  createdAt: number;
}): string {
  return [
    "7key recovery code",
    "",
    `Account: ${details.email}`,
    `Server: ${details.server}`,
    `Created: ${new Date(details.createdAt * 1000).toISOString().slice(0, 10)}`,
    "",
    details.code,
    "",
    'Use it with "Forgot master password?" to set a new master password.',
    "Anyone with this code and your email can open your vault. Keep it offline.",
    "",
  ].join("\n");
}

export function downloadRecoveryKit(text: string, filename = "7key-recovery-code.txt"): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
