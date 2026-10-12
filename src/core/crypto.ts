/**
 * The vault's cryptography. WebCrypto only, no dependencies — in an app that
 * holds every password you own, each third-party library is one more place
 * malicious code could be planted.
 *
 * Key flow (see docs/design.md §2):
 *
 *   master password + email
 *        -> PBKDF2-SHA256 600k  -> master key
 *        -> HKDF "auth"         -> auth key        (sent to the server)
 *        -> HKDF "enc"          -> wrapping key    (NEVER leaves the client)
 *                                -> unwraps wrapped_vault_key -> vault key
 *                                -> AES-256-GCM per item
 */

import { concat, fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { VaultError } from "./errors.js";

export type KdfType = "pbkdf2-sha256";

export interface KdfParams {
  type: KdfType;
  iterations: number;
  salt: string; // base64
}

/**
 * 600,000 iterations is Bitwarden's current default and the OWASP guidance for
 * PBKDF2-SHA256. It costs roughly 0.5–1s on a typical machine, which is an
 * acceptable price at unlock time.
 */
export const DEFAULT_KDF_ITERATIONS = 600_000;

/** AES-GCM wants a 96-bit nonce; this is the only recommended length. */
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export interface SealedData {
  ciphertext: string; // base64
  nonce: string; // base64
}

/** Everything the server stores for an account. None of it can decrypt a vault. */
export interface AccountCryptoRecord {
  kdf: KdfParams;
  authKey: string; // base64 — the server hashes this before storing it
  wrappedVaultKey: SealedData;
}

// Key derivation

/**
 * The email is used as salt rather than a random value stored server-side.
 *
 * An email is not an ideal salt (it is not random), but it lets you sign in on a
 * new machine with nothing but email and master password: the client can derive
 * the auth key *before* contacting the server, so the server never has to hand a
 * salt to an unauthenticated caller. Bitwarden and 1Password make the same
 * trade.
 *
 * A random salt from `params` is still mixed in, so registering the same email
 * twice does not produce the same key.
 */
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

/**
 * Split the master key into two independent keys with HKDF.
 *
 * This is the most important protection in the design: the server gets `auth` to
 * identify you, but `enc` cannot be computed from it. Share one key between both
 * jobs and anyone who observes a login request can decrypt the whole vault.
 */
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
  // `extractable: false` — once imported the key material cannot be read back
  // from JavaScript, so even an XSS bug in the popup cannot exfiltrate it.
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Symmetric encryption

export async function seal(
  key: CryptoKey,
  plaintext: Bytes,
  associatedData?: Bytes,
): Promise<SealedData> {
  // A fresh nonce per encryption. Reusing a nonce with the same AES-GCM key is
  // catastrophic: it leaks plaintext *and* the authentication key.
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

// Vault key

/**
 * The vault key is genuinely random, not derived from the master password.
 *
 * That is what makes changing the master password cheap: re-wrap the vault key
 * with the new wrapping key and no item is touched. Without this layer, changing
 * the password on a 500-item vault means 500 writes and one chance to lose data
 * halfway through.
 */
export function createVaultKey(): Bytes {
  return randomBytes(KEY_BYTES);
}

export async function importVaultKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) {
    throw new VaultError("crypto.bad_key_length", {}, `Vault key must be ${KEY_BYTES} bytes`);
  }
  return importAesKey(raw);
}

/** Build the crypto material for a new account, returning a usable vault key. */
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

/**
 * Unlock a vault from the master password plus what the server returned.
 *
 * A wrong password makes `open()` throw because the GCM tag does not verify —
 * that is how we detect it without the server confirming anything, and why
 * AES-GCM (authenticated) was chosen over AES-CBC (not).
 */
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

/** Change the master password: re-wrap the vault key, touch no items. */
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

// Server side

/**
 * Hash the auth key for storage in D1.
 *
 * A single SHA-256 round is enough here, unlike for an ordinary password: the
 * auth key is already 32 bytes of uniform entropy produced by 600,000 PBKDF2
 * iterations. No dictionary can reach it, so a slow hash would only burn Worker
 * CPU without adding security.
 */
export async function hashAuthKey(authKeyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(authKeyBase64));
  return toBase64(new Uint8Array(digest));
}
