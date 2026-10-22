import { base32Decode, base32Encode } from "./base32.js";
import { randomBytes, toBase64, utf8Encode, type Bytes } from "./bytes.js";
import { open, seal, type SealedData } from "./crypto.js";

const CODE_BYTES = 20;
const GROUP = 4;
const SALT = utf8Encode("personal-vault/recovery/v1");
const VAULT_KEY_CONTEXT = utf8Encode("personal-vault/recovery-vault-key");

export interface RecoveryMaterial {
  authKey: string;
  wrappedVaultKey: SealedData;
}

export function generateRecoveryCode(): string {
  const text = base32Encode(randomBytes(CODE_BYTES)).replace(/=+$/, "");
  return text.match(new RegExp(`.{1,${GROUP}}`, "g"))!.join("-");
}

export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]{32}$/.test(compact)) {
    return null;
  }
  return compact;
}

async function hkdf(
  code: string,
  info: string,
  usage: "wrap" | "bits",
): Promise<CryptoKey | Bytes> {
  const material = await crypto.subtle.importKey("raw", base32Decode(code), "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const params = { name: "HKDF", hash: "SHA-256", salt: SALT, info: utf8Encode(info) };
  if (usage === "bits") {
    return new Uint8Array(await crypto.subtle.deriveBits(params, material, 256));
  }
  return crypto.subtle.deriveKey(params, material, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function keys(input: string): Promise<{ wrap: CryptoKey; auth: string }> {
  const code = normalizeRecoveryCode(input);
  if (!code) {
    throw new RangeError("Not a recovery code");
  }
  const [wrap, auth] = await Promise.all([
    hkdf(code, "wrap", "wrap") as Promise<CryptoKey>,
    hkdf(code, "auth", "bits") as Promise<Bytes>,
  ]);
  return { wrap, auth: toBase64(auth) };
}

export async function recoveryAuthKey(code: string): Promise<string> {
  return (await keys(code)).auth;
}

export async function sealForRecovery(code: string, vaultKeyRaw: Bytes): Promise<RecoveryMaterial> {
  const { wrap, auth } = await keys(code);
  return { authKey: auth, wrappedVaultKey: await seal(wrap, vaultKeyRaw, VAULT_KEY_CONTEXT) };
}

export async function openWithRecovery(code: string, wrapped: SealedData): Promise<Bytes> {
  const { wrap } = await keys(code);
  return open(wrap, wrapped, VAULT_KEY_CONTEXT);
}
