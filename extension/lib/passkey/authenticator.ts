import { fromBase64Url, toBase64Url } from "./base64url.js";
import { encodeCbor, type CborValue } from "./cbor.js";
import { ES256, type AssertionJSON, type RegistrationJSON } from "./protocol.js";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_CREDENTIAL = 0x40;
const SYNCED_PASSKEY_FLAGS =
  FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;
const AAGUID = new Uint8Array(16);
const EC_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface StoredPasskey {
  credentialId: string;
  rpId: string;
  userHandle: string;
  userName: string;
  userDisplayName?: string;
  privateKey: string;
  createdAt: number;
}

export interface ClientData {
  type: "webauthn.create" | "webauthn.get";
  challenge: string;
  origin: string;
}

export interface CreatedPasskey {
  registration: RegistrationJSON;
  passkey: StoredPasskey;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export function clientDataJson(data: ClientData): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify({
      type: data.type,
      challenge: data.challenge,
      origin: data.origin,
      crossOrigin: false,
    }),
  );
}

function coseKey(rawPublicKey: Uint8Array): Uint8Array {
  return encodeCbor(
    new Map<CborValue, CborValue>([
      [1, 2],
      [3, ES256],
      [-1, 1],
      [-2, rawPublicKey.slice(1, 33)],
      [-3, rawPublicKey.slice(33, 65)],
    ]),
  );
}

async function authenticatorData(
  rpId: string,
  flags: number,
  attestedCredential?: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  return concat(
    rpIdHash,
    new Uint8Array([flags | (attestedCredential ? FLAG_ATTESTED_CREDENTIAL : 0)]),
    new Uint8Array(4),
    attestedCredential ?? new Uint8Array(0),
  );
}

function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = bytes.slice(start);
    const padded = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, padded.length]), padded);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32, 64)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function createPasskey(input: {
  rpId: string;
  origin: string;
  challenge: string;
  userHandle: string;
  userName: string;
  userDisplayName?: string;
  now?: number;
}): Promise<CreatedPasskey> {
  const keys = await crypto.subtle.generateKey(EC_ALGORITHM, true, ["sign", "verify"]);
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const attested = concat(
    AAGUID,
    new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]),
    credentialId,
    coseKey(rawPublicKey),
  );
  const authData = await authenticatorData(input.rpId, SYNCED_PASSKEY_FLAGS, attested);
  const attestationObject = encodeCbor(
    new Map<CborValue, CborValue>([
      ["fmt", "none"],
      ["attStmt", new Map<CborValue, CborValue>()],
      ["authData", authData],
    ]),
  );
  const clientData = clientDataJson({
    type: "webauthn.create",
    challenge: input.challenge,
    origin: input.origin,
  });

  return {
    registration: {
      credentialId: toBase64Url(credentialId),
      clientDataJSON: toBase64Url(clientData),
      attestationObject: toBase64Url(attestationObject),
      authenticatorData: toBase64Url(authData),
      publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey))),
      publicKeyAlgorithm: ES256,
    },
    passkey: {
      credentialId: toBase64Url(credentialId),
      rpId: input.rpId,
      userHandle: input.userHandle,
      userName: input.userName,
      userDisplayName: input.userDisplayName,
      privateKey: toBase64Url(
        new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
      ),
      createdAt: input.now ?? Math.floor(Date.now() / 1000),
    },
  };
}

export async function signAssertion(
  passkey: StoredPasskey,
  input: { origin: string; challenge: string },
): Promise<AssertionJSON> {
  const authData = await authenticatorData(passkey.rpId, SYNCED_PASSKEY_FLAGS);
  const clientData = clientDataJson({
    type: "webauthn.get",
    challenge: input.challenge,
    origin: input.origin,
  });
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(passkey.privateKey),
    EC_ALGORITHM,
    false,
    ["sign"],
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      concat(authData, await sha256(clientData)),
    ),
  );
  return {
    credentialId: passkey.credentialId,
    clientDataJSON: toBase64Url(clientData),
    authenticatorData: toBase64Url(authData),
    signature: toBase64Url(derSignature(raw)),
    userHandle: passkey.userHandle,
  };
}
