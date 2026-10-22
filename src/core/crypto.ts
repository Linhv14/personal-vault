import { concat, fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { VaultError } from "./errors.js";
import { isPlainObject } from "./json.js";

export type KdfType = "pbkdf2-sha256";

export interface KdfParams {
  type: KdfType;
  iterations: number;
  salt: string;
}

export const DEFAULT_KDF_ITERATIONS = 600_000;

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export interface SealedData {
  ciphertext: string;
  nonce: string;
}

export function isKdfParams(value: unknown): value is KdfParams {
  return (
    isPlainObject(value) &&
    value.type === "pbkdf2-sha256" &&
    typeof value.iterations === "number" &&
    Number.isInteger(value.iterations) &&
    value.iterations > 0 &&
    typeof value.salt === "string"
  );
}

export function isSealedData(value: unknown): value is SealedData {
  return (
    isPlainObject(value) && typeof value.ciphertext === "string" && typeof value.nonce === "string"
  );
}

export interface AccountCryptoRecord {
  kdf: KdfParams;
  authKey: string;
  wrappedVaultKey: SealedData;
}

export async function deriveMasterKey(
  email: string,
  masterPassword: string,
  params: KdfParams,
): Promise<Bytes> {
  if (params.type !== "pbkdf2-sha256") {
    throw new VaultError("crypto.unsupported_kdf", { kdf: params.type }, `Unknown KDF`);
  }
  if (masterPassword.length === 0) {
    throw new VaultError("crypto.empty_password", {}, "Master password is empty");
  }

  const salt = concat(utf8Encode(normalizeEmail(email)), fromBase64(params.salt));

  const baseKey = await crypto.subtle.importKey(
    "raw",
    utf8Encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: params.iterations, hash: "SHA-256" },
    baseKey,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function hkdfExpand(masterKey: Bytes, info: "auth" | "enc"): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", masterKey, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8Encode(info) },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveAuthKey(masterKey: Bytes): Promise<Bytes> {
  return hkdfExpand(masterKey, "auth");
}

export async function deriveWrappingKey(masterKey: Bytes): Promise<CryptoKey> {
  const raw = await hkdfExpand(masterKey, "enc");
  return importAesKey(raw);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(
  key: CryptoKey,
  plaintext: Bytes,
  associatedData?: Bytes,
): Promise<SealedData> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, ...(associatedData && { additionalData: associatedData }) },
    key,
    plaintext,
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce) };
}

export async function open(
  key: CryptoKey,
  sealed: SealedData,
  associatedData?: Bytes,
): Promise<Bytes> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(sealed.nonce),
      ...(associatedData && { additionalData: associatedData }),
    },
    key,
    fromBase64(sealed.ciphertext),
  );
  return new Uint8Array(plaintext);
}

export async function sealJson(
  key: CryptoKey,
  value: unknown,
  associatedData?: Bytes,
): Promise<SealedData> {
  return seal(key, utf8Encode(JSON.stringify(value)), associatedData);
}

export async function openJson<T>(
  key: CryptoKey,
  sealed: SealedData,
  associatedData?: Bytes,
): Promise<T> {
  return JSON.parse(utf8Decode(await open(key, sealed, associatedData))) as T;
}

export function createVaultKey(): Bytes {
  return randomBytes(KEY_BYTES);
}

export async function importVaultKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) {
    throw new VaultError("crypto.bad_key_length", {}, `Vault key must be ${KEY_BYTES} bytes`);
  }
  return importAesKey(raw);
}

export async function createAccount(
  email: string,
  masterPassword: string,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<{ record: AccountCryptoRecord; vaultKey: CryptoKey }> {
  const kdf: KdfParams = {
    type: "pbkdf2-sha256",
    iterations,
    salt: toBase64(randomBytes(16)),
  };

  const masterKey = await deriveMasterKey(email, masterPassword, kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);

  const vaultKeyRaw = createVaultKey();
  const wrappedVaultKey = await seal(wrappingKey, vaultKeyRaw);

  return {
    record: { kdf, authKey: toBase64(authKey), wrappedVaultKey },
    vaultKey: await importVaultKey(vaultKeyRaw),
  };
}

export async function unlockVault(
  email: string,
  masterPassword: string,
  record: Pick<AccountCryptoRecord, "kdf" | "wrappedVaultKey">,
): Promise<{ vaultKey: CryptoKey; vaultKeyRaw: Bytes; authKey: string }> {
  const masterKey = await deriveMasterKey(email, masterPassword, record.kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);

  let vaultKeyRaw: Bytes;
  try {
    vaultKeyRaw = await open(wrappingKey, record.wrappedVaultKey);
  } catch {
    throw new VaultError("crypto.wrong_password", {}, "GCM tag mismatch unwrapping vault key");
  }

  return {
    vaultKey: await importVaultKey(vaultKeyRaw),
    vaultKeyRaw,
    authKey: toBase64(authKey),
  };
}

export async function rewrapVaultKey(
  email: string,
  newMasterPassword: string,
  vaultKeyRaw: Bytes,
  iterations = DEFAULT_KDF_ITERATIONS,
): Promise<AccountCryptoRecord> {
  const kdf: KdfParams = {
    type: "pbkdf2-sha256",
    iterations,
    salt: toBase64(randomBytes(16)),
  };
  const masterKey = await deriveMasterKey(email, newMasterPassword, kdf);
  const [authKey, wrappingKey] = await Promise.all([
    deriveAuthKey(masterKey),
    deriveWrappingKey(masterKey),
  ]);
  return {
    kdf,
    authKey: toBase64(authKey),
    wrappedVaultKey: await seal(wrappingKey, vaultKeyRaw),
  };
}

export async function hashAuthKey(authKeyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(authKeyBase64));
  return toBase64(new Uint8Array(digest));
}
