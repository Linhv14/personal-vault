import { concat, fromBase64, utf8Encode, type Bytes } from "../../src/core/bytes.js";
import { openJson, sealJson, type SealedData } from "../../src/core/crypto.js";
import { ApiError } from "./api.js";
import { getUnlocked } from "./storage.js";

export type DeviceMethod = "pin" | "biometric";

export type Rejection = "gone" | "denied";

async function wrappingKey(method: DeviceMethod, serverKey: string, local: Bytes) {
  const purpose = utf8Encode(`personal-vault/${method}`);
  const material = await crypto.subtle.importKey(
    "raw",
    concat(fromBase64(serverKey), local),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: purpose },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, purpose };
}

export async function sealVaultKey(
  method: DeviceMethod,
  serverKey: string,
  local: Bytes,
  vaultKeyRaw: string,
): Promise<SealedData> {
  const { key, purpose } = await wrappingKey(method, serverKey, local);
  return sealJson(key, { vaultKeyRaw }, purpose);
}

export async function openVaultKey(
  method: DeviceMethod,
  serverKey: string,
  local: Bytes,
  sealed: SealedData,
): Promise<string> {
  const { key, purpose } = await wrappingKey(method, serverKey, local);
  return (await openJson<{ vaultKeyRaw: string }>(key, sealed, purpose)).vaultKeyRaw;
}

export async function signedInSession(): Promise<{ vaultKeyRaw: string; token: string }> {
  const session = await getUnlocked();
  if (!session?.token) throw new ApiError("error.api.not_signed_in", 401);
  return { vaultKeyRaw: session.vaultKeyRaw, token: session.token };
}

export function rejection(error: unknown): Rejection | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 410 || error.status === 401) return "gone";
  if (error.status === 403) return "denied";
  return null;
}

export async function forget(method: DeviceMethod): Promise<void> {
  await chrome.storage.local.remove(method);
}
