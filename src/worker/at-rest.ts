import { hashAuthKey } from "#core/crypto.js";
import {
  concat,
  fromBase64,
  randomBytes,
  timingSafeEqual,
  toBase64,
  utf8Encode,
} from "#core/bytes.js";

export interface AtRestEnv {
  AT_REST_SECRET: string;
}

const VERSION_PREFIX = "v2:";
const NONCE_BYTES = 12;

interface AtRestKeys {
  authHmac: CryptoKey;
  wrap: CryptoKey;
  twoFactorSecret: CryptoKey;
  backupCodeHmac: CryptoKey;
}

let cached: { secret: string; keys: Promise<AtRestKeys> } | null = null;

function keysFor(env: AtRestEnv): Promise<AtRestKeys> {
  const secret = env.AT_REST_SECRET;
  if (!secret) {
    throw new Error("AT_REST_SECRET is not configured");
  }
  if (cached?.secret !== secret) {
    cached = { secret, keys: deriveKeys(secret) };
  }
  return cached.keys;
}

async function deriveKeys(secret: string): Promise<AtRestKeys> {
  const root = await crypto.subtle.importKey("raw", utf8Encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  const hkdf = (info: string) => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8Encode(`personal-vault/at-rest/${info}`),
  });

  const [authHmac, wrap, twoFactorSecret, backupCodeHmac] = await Promise.all([
    crypto.subtle.deriveKey(
      hkdf("auth-key-hash"),
      root,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    ),
    crypto.subtle.deriveKey(
      hkdf("wrapped-vault-key"),
      root,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveKey(
      hkdf("two-factor-secret"),
      root,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.deriveKey(
      hkdf("two-factor-backup-code"),
      root,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    ),
  ]);
  return { authHmac, wrap, twoFactorSecret, backupCodeHmac };
}

export async function protectAuthKey(env: AtRestEnv, authKeyBase64: string): Promise<string> {
  const { authHmac } = await keysFor(env);
  const mac = await crypto.subtle.sign("HMAC", authHmac, fromBase64(authKeyBase64));
  return VERSION_PREFIX + toBase64(new Uint8Array(mac));
}

export async function verifyAuthKey(
  env: AtRestEnv,
  authKeyBase64: string,
  stored: string,
  { acceptLegacy = false }: { acceptLegacy?: boolean } = {},
): Promise<{ matches: boolean; needsUpgrade: boolean }> {
  const legacy = !stored.startsWith(VERSION_PREFIX);
  if (legacy && !acceptLegacy) {
    await protectAuthKey(env, authKeyBase64);
    return { matches: false, needsUpgrade: false };
  }
  const computed = legacy
    ? await hashAuthKey(authKeyBase64)
    : await protectAuthKey(env, authKeyBase64);
  return {
    matches: timingSafeEqual(utf8Encode(computed), utf8Encode(stored)),
    needsUpgrade: legacy,
  };
}

export function recoveryScope(accountId: string): string {
  return `${accountId}/recovery`;
}

function wrapAad(accountId: string): Uint8Array<ArrayBuffer> {
  return utf8Encode(`personal-vault/wrapped-vault-key/${accountId}`);
}

export async function protectWrappedKey(
  env: AtRestEnv,
  accountId: string,
  clientCiphertextBase64: string,
): Promise<string> {
  const { wrap } = await keysFor(env);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: wrapAad(accountId) },
    wrap,
    fromBase64(clientCiphertextBase64),
  );
  return VERSION_PREFIX + toBase64(concat(nonce, new Uint8Array(sealed)));
}

export async function revealWrappedKey(
  env: AtRestEnv,
  accountId: string,
  stored: string,
): Promise<{ ciphertext: string; needsUpgrade: boolean }> {
  if (!stored.startsWith(VERSION_PREFIX)) {
    return { ciphertext: stored, needsUpgrade: true };
  }

  const { wrap } = await keysFor(env);
  const blob = fromBase64(stored.slice(VERSION_PREFIX.length));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, NONCE_BYTES), additionalData: wrapAad(accountId) },
    wrap,
    blob.slice(NONCE_BYTES),
  );
  return { ciphertext: toBase64(new Uint8Array(plaintext)), needsUpgrade: false };
}

function twoFactorAad(accountId: string): Uint8Array<ArrayBuffer> {
  return utf8Encode(`personal-vault/two-factor-secret/${accountId}`);
}

export async function protectTwoFactorSecret(
  env: AtRestEnv,
  accountId: string,
  secret: string,
): Promise<string> {
  const { twoFactorSecret } = await keysFor(env);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: twoFactorAad(accountId) },
    twoFactorSecret,
    utf8Encode(secret),
  );
  return VERSION_PREFIX + toBase64(concat(nonce, new Uint8Array(sealed)));
}

export async function revealTwoFactorSecret(
  env: AtRestEnv,
  accountId: string,
  stored: string,
): Promise<string> {
  if (!stored.startsWith(VERSION_PREFIX)) {
    throw new Error("Unexpected two-factor secret format");
  }
  const { twoFactorSecret } = await keysFor(env);
  const blob = fromBase64(stored.slice(VERSION_PREFIX.length));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, NONCE_BYTES), additionalData: twoFactorAad(accountId) },
    twoFactorSecret,
    blob.slice(NONCE_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}

export async function protectBackupCode(
  env: AtRestEnv,
  accountId: string,
  code: string,
): Promise<string> {
  const { backupCodeHmac } = await keysFor(env);
  const mac = await crypto.subtle.sign("HMAC", backupCodeHmac, utf8Encode(`${accountId}:${code}`));
  return VERSION_PREFIX + toBase64(new Uint8Array(mac));
}
