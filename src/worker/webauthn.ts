import { fromBase64Url, timingSafeEqual, utf8Encode, type Bytes } from "../core/bytes.js";

export const ES256 = -7;
export const RS256 = -257;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

export interface ExpectedAssertion {
  publicKey: string;
  algorithm: number;
  rpId: string;
  origin: string;
  challenge: string;
}

export interface AssertionInput {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function rawEcdsaSignature(der: Bytes): Bytes | null {
  if (der[0] !== 0x30) return null;
  const out = new Uint8Array(64);
  let offset = 2;
  for (const target of [0, 32]) {
    if (der[offset] !== 0x02) return null;
    const length = der[offset + 1] ?? 0;
    let value = der.slice(offset + 2, offset + 2 + length);
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) return null;
    out.set(value, target + 32 - value.length);
    offset += 2 + length;
  }
  return out;
}

async function importPublicKey(spki: Bytes, algorithm: number): Promise<CryptoKey | null> {
  if (algorithm === ES256) {
    return crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
  }
  if (algorithm === RS256) {
    return crypto.subtle.importKey(
      "spki",
      spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  return null;
}

export async function verifyAssertion(
  expected: ExpectedAssertion,
  input: AssertionInput,
): Promise<boolean> {
  try {
    const clientDataBytes = fromBase64Url(input.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
      type?: unknown;
      challenge?: unknown;
      origin?: unknown;
    };
    if (clientData.type !== "webauthn.get") return false;
    if (clientData.origin !== expected.origin) return false;
    if (typeof clientData.challenge !== "string") return false;
    if (!timingSafeEqual(utf8Encode(clientData.challenge), utf8Encode(expected.challenge))) {
      return false;
    }

    const authData = fromBase64Url(input.authenticatorData);
    if (authData.length < 37) return false;
    const rpIdHash = await sha256(utf8Encode(expected.rpId));
    if (!timingSafeEqual(authData.slice(0, 32), rpIdHash)) return false;
    const flags = authData[32] ?? 0;
    if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED)) return false;

    const key = await importPublicKey(fromBase64Url(expected.publicKey), expected.algorithm);
    if (!key) return false;
    const signed = new Uint8Array(authData.length + 32);
    signed.set(authData);
    signed.set(await sha256(clientDataBytes), authData.length);
    const signature = fromBase64Url(input.signature);

    if (expected.algorithm === ES256) {
      const raw = rawEcdsaSignature(signature);
      return (
        raw !== null && crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed)
      );
    }
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  } catch {
    return false;
  }
}
