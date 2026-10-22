import { fromBase64Url, utf8Decode, utf8Encode, type Bytes } from "#core/bytes.js";
import { isPlainObject, isPositiveInteger, isStringArray } from "#core/json.js";

export const LICENSE_PREFIX = "7key-license-v1";
const MAX_LICENSE_LENGTH = 4096;

export interface License {
  licensee: string;
  seats: number;
  expiresAt: number;
  features: string[];
}

export type LicenseCheck =
  | { status: "valid"; license: License }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "expired"; license: License };

function asLicense(value: unknown): License | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const { licensee, seats, expiresAt, features } = value;
  if (
    typeof licensee !== "string" ||
    licensee.length === 0 ||
    licensee.length > 200 ||
    !isPositiveInteger(seats) ||
    !isPositiveInteger(expiresAt) ||
    !isStringArray(features)
  ) {
    return null;
  }
  return { licensee, seats, expiresAt, features };
}

async function signatureValid(publicKey: Bytes, signature: Bytes, signed: Bytes) {
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signed);
  } catch {
    return false;
  }
}

export async function checkLicense(
  token: string | undefined,
  publicKeys: readonly string[],
  now: number,
): Promise<LicenseCheck> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) {
    return { status: "missing" };
  }
  if (trimmed.length > MAX_LICENSE_LENGTH) {
    return { status: "invalid" };
  }
  const [prefix, payloadPart, signaturePart, extra] = trimmed.split(".");
  if (prefix !== LICENSE_PREFIX || !payloadPart || !signaturePart || extra !== undefined) {
    return { status: "invalid" };
  }
  let payload: unknown;
  let signature: Bytes;
  try {
    payload = JSON.parse(utf8Decode(fromBase64Url(payloadPart)));
    signature = fromBase64Url(signaturePart);
  } catch {
    return { status: "invalid" };
  }
  const signed = utf8Encode(`${prefix}.${payloadPart}`);
  let trusted = false;
  for (const publicKey of publicKeys) {
    let raw: Bytes;
    try {
      raw = fromBase64Url(publicKey);
    } catch {
      continue;
    }
    if (await signatureValid(raw, signature, signed)) {
      trusted = true;
      break;
    }
  }
  const license = asLicense(payload);
  if (!trusted || !license) {
    return { status: "invalid" };
  }
  return license.expiresAt <= now ? { status: "expired", license } : { status: "valid", license };
}

export function licenseAllows(check: LicenseCheck, feature: string): boolean {
  return check.status === "valid" && check.license.features.includes(feature);
}
