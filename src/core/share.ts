import { fromBase64Url, randomBytes, toBase64Url, utf8Decode, utf8Encode } from "./bytes.js";
import type { Bytes } from "./bytes.js";
import { open, seal, type SealedData } from "./crypto.js";
import { VaultError } from "./errors.js";
import { isPlainObject } from "./json.js";
import { parseTotpConfig, type TotpConfig } from "./totp.js";

export interface SharePayload {
  title?: string;
  url?: string;
  username?: string;
  password?: string;
  note?: string;
  totp?: TotpConfig;
  fields?: { label: string; value: string; hidden?: boolean }[];
}

type ShareField = NonNullable<SharePayload["fields"]>[number];

const TEXT_KEYS = ["title", "url", "username", "password", "note"] as const;

function parseShareField(value: unknown): ShareField | null {
  if (
    !isPlainObject(value) ||
    typeof value.label !== "string" ||
    typeof value.value !== "string" ||
    (value.hidden !== undefined && typeof value.hidden !== "boolean")
  ) {
    return null;
  }
  return {
    label: value.label,
    value: value.value,
    ...(value.hidden === undefined ? {} : { hidden: value.hidden }),
  };
}

export function parseSharePayload(value: unknown): SharePayload | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const payload: SharePayload = {};
  for (const key of TEXT_KEYS) {
    const text = value[key];
    if (text === undefined) {
      continue;
    }
    if (typeof text !== "string") {
      return null;
    }
    payload[key] = text;
  }
  if (value.totp !== undefined) {
    const totp = parseTotpConfig(value.totp);
    if (!totp) {
      return null;
    }
    payload.totp = totp;
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields)) {
      return null;
    }
    const fields = value.fields.map(parseShareField);
    if (fields.some((field) => field === null)) {
      return null;
    }
    payload.fields = fields.filter((field) => field !== null);
  }
  return payload;
}

export interface CreatedShare {
  sealed: SealedData;
  fragment: string;
}

const PASSPHRASE_MARKER = ".p";

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

  let plaintext: Bytes;
  try {
    plaintext = await open(key, sealed);
  } catch {
    throw new VaultError(
      needsPassphrase ? "share.wrong_passphrase" : "share.undecryptable",
      {},
      "AES-GCM authentication failed",
    );
  }
  const payload = parseSharePayload(parseJsonOrNull(utf8Decode(plaintext)));
  if (!payload) {
    throw new VaultError("share.undecryptable", {}, "Share payload has an unexpected shape");
  }
  return payload;
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripHash(fragment: string): string {
  return fragment.startsWith("#") ? fragment.slice(1) : fragment;
}

export function buildShareUrl(origin: string, id: string, fragment: string): string {
  return `${origin.replace(/\/$/, "")}/s/${id}#${fragment}`;
}
