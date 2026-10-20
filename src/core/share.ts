/**
 * Encryption for share links.
 *
 * The rule: the key lives in the URL fragment (`#...`), the one part of a URL a
 * browser never sends to the server. The Worker holds ciphertext only. Even a
 * full dump of D1 decrypts to nothing without the links.
 *
 * The remaining limitation: whatever channel carries the link — a chat app,
 * email — can read the fragment too, because to them a link is just text. Hence
 * the optional extra passphrase below: delivered over a different channel, one
 * compromised channel is no longer enough.
 */

import { fromBase64Url, randomBytes, toBase64Url, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { open, seal, type SealedData } from "./crypto.js";
import { VaultError } from "./errors.js";
import type { TotpConfig } from "./totp.js";

export interface SharePayload {
  title?: string;
  url?: string;
  username?: string;
  password?: string;
  note?: string;
  totp?: TotpConfig;
  fields?: { label: string; value: string; hidden?: boolean }[];
}

export interface CreatedShare {
  sealed: SealedData;
  /** The string to place after `#` in the link. Never sent to a server. */
  fragment: string;
}

/** Suffix marking a link that needs a passphrase, so the page can ask first. */
const PASSPHRASE_MARKER = ".p";

/**
 * Derive the real key from the link key and the optional passphrase.
 *
 * HKDF with the passphrase as salt: both are required to reach the same key. The
 * passphrase does not need to be strong — the link key already carries 256 bits
 * of entropy — it is a second factor, not a source of entropy.
 */
async function deriveShareKey(keyMaterial: Bytes, passphrase?: string): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: passphrase ? utf8Encode(passphrase) : new Uint8Array(0),
      info: utf8Encode("share"),
    },
    hkdfKey,
    256,
  );
  return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function createShare(
  payload: SharePayload,
  passphrase?: string,
): Promise<CreatedShare> {
  const keyMaterial = randomBytes(32);
  const key = await deriveShareKey(keyMaterial, passphrase);
  const sealed = await seal(key, utf8Encode(JSON.stringify(payload)));

  return {
    sealed,
    fragment: toBase64Url(keyMaterial) + (passphrase ? PASSPHRASE_MARKER : ""),
  };
}

/** The recipient page calls this to decide whether to prompt for a passphrase. */
export function fragmentNeedsPassphrase(fragment: string): boolean {
  return stripHash(fragment).endsWith(PASSPHRASE_MARKER);
}

export async function openShare(
  fragment: string,
  sealed: SealedData,
  passphrase?: string,
): Promise<SharePayload> {
  const raw = stripHash(fragment);
  const needsPassphrase = raw.endsWith(PASSPHRASE_MARKER);
  const keyPart = needsPassphrase ? raw.slice(0, -PASSPHRASE_MARKER.length) : raw;

  if (needsPassphrase && !passphrase) {
    throw new VaultError("share.passphrase_required", {}, "Link requires a passphrase");
  }

  let keyMaterial: Bytes;
  try {
    keyMaterial = fromBase64Url(keyPart);
  } catch {
    throw new VaultError("share.invalid_key", {}, "Fragment is not valid base64url");
  }
  if (keyMaterial.length !== 32) {
    throw new VaultError("share.invalid_key", {}, `Key is ${keyMaterial.length} bytes, need 32`);
  }

  const key = await deriveShareKey(keyMaterial, needsPassphrase ? passphrase : undefined);

  try {
    const plaintext = await open(key, sealed);
    return JSON.parse(new TextDecoder().decode(plaintext)) as SharePayload;
  } catch {
    // GCM tag mismatch. For a passphrase-protected link that is almost always a
    // mistyped passphrase rather than a damaged link.
    throw new VaultError(
      needsPassphrase ? "share.wrong_passphrase" : "share.undecryptable",
      {},
      "AES-GCM authentication failed",
    );
  }
}

function stripHash(fragment: string): string {
  return fragment.startsWith("#") ? fragment.slice(1) : fragment;
}

export function buildShareUrl(origin: string, id: string, fragment: string): string {
  return `${origin.replace(/\/$/, "")}/s/${id}#${fragment}`;
}
