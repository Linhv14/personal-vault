import { concat, fromBase64, randomBytes, toBase64, utf8Encode, type Bytes } from "./bytes.js";
import { open, seal, type SealedData } from "./crypto.js";

const CURVE = { name: "ECDH", namedCurve: "P-256" } as const;
const WRAP_INFO = utf8Encode("personal-vault/key-wrap/v1");
const MAX_SPKI_BYTES = 128;

export interface Identity {
  publicKey: string;
  privateKey: Bytes;
}

export interface WrappedForRecipient {
  ephemeralPublicKey: string;
  sealed: SealedData;
}

async function exportBytes(format: "spki" | "pkcs8", key: CryptoKey): Promise<Bytes> {
  return new Uint8Array((await crypto.subtle.exportKey(format, key)) as ArrayBuffer);
}

export async function createIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey(CURVE, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    publicKey: toBase64(await exportBytes("spki", pair.publicKey)),
    privateKey: await exportBytes("pkcs8", pair.privateKey),
  };
}

export function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const bytes = fromBase64(value);
    return bytes.length > 0 && bytes.length <= MAX_SPKI_BYTES;
  } catch {
    return false;
  }
}

async function importPublic(spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromBase64(spki), CURVE, false, []);
}

async function importPrivate(pkcs8: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, CURVE, false, ["deriveBits"]);
}

async function wrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  ephemeral: string,
  recipient: string,
): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0],
      privateKey,
      256,
    ),
  );
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: concat(fromBase64(ephemeral), fromBase64(recipient)),
      info: WRAP_INFO,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapForRecipient(
  recipientPublicKey: string,
  payload: Bytes,
  context: Bytes,
): Promise<WrappedForRecipient> {
  const ephemeral = (await crypto.subtle.generateKey(CURVE, true, ["deriveBits"])) as CryptoKeyPair;
  const ephemeralPublicKey = toBase64(await exportBytes("spki", ephemeral.publicKey));
  const key = await wrappingKey(
    ephemeral.privateKey,
    await importPublic(recipientPublicKey),
    ephemeralPublicKey,
    recipientPublicKey,
  );
  return { ephemeralPublicKey, sealed: await seal(key, payload, context) };
}

export async function unwrapForRecipient(
  identity: Identity,
  wrapped: WrappedForRecipient,
  context: Bytes,
): Promise<Bytes> {
  const key = await wrappingKey(
    await importPrivate(identity.privateKey),
    await importPublic(wrapped.ephemeralPublicKey),
    wrapped.ephemeralPublicKey,
    identity.publicKey,
  );
  return open(key, wrapped.sealed, context);
}

export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64(publicKey)));
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.toUpperCase().match(/.{4}/g)!.join(" ");
}

export function randomKey(): Bytes {
  return randomBytes(32);
}
