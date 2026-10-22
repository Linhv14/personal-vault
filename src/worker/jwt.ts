import { fromBase64Url, utf8Decode, utf8Encode, type Bytes } from "#core/bytes.js";
import { isPlainObject } from "#core/json.js";

export const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 8192;

export type JwsAlgorithm = "RS256" | "ES256";

export type Jwk =
  | { kid: string; kty: "RSA"; n: string; e: string }
  | { kid: string; kty: "EC"; crv: "P-256"; x: string; y: string };

export type JwksSource = (kid: string) => Promise<Jwk[]>;

export type JwtClaims = Record<string, unknown>;

function isJwk(value: unknown): value is Jwk {
  if (!isPlainObject(value) || typeof value.kid !== "string") {
    return false;
  }
  if (value.kty === "RSA") {
    return typeof value.n === "string" && typeof value.e === "string";
  }
  return (
    value.kty === "EC" &&
    value.crv === "P-256" &&
    typeof value.x === "string" &&
    typeof value.y === "string"
  );
}

export function validJwks(value: unknown): Jwk[] {
  return Array.isArray(value) ? value.filter(isJwk) : [];
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(utf8Decode(fromBase64Url(part)));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function audienceMatches(aud: unknown, expected: readonly string[]): boolean {
  const given = Array.isArray(aud) ? aud : [aud];
  return given.some((entry) => typeof entry === "string" && expected.includes(entry));
}

export function withinLifetime(claims: JwtClaims, now: number): boolean {
  const { exp, nbf, iat } = claims;
  if (typeof exp !== "number" || exp + CLOCK_SKEW_SECONDS < now) {
    return false;
  }
  if (nbf !== undefined && (typeof nbf !== "number" || nbf - CLOCK_SKEW_SECONDS > now)) {
    return false;
  }
  return iat === undefined || (typeof iat === "number" && iat - CLOCK_SKEW_SECONDS <= now);
}

async function verifyWith(jwk: Jwk, signature: Bytes, signed: Bytes): Promise<boolean> {
  try {
    if (jwk.kty === "RSA") {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
    }
    if (signature.length !== 64) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed);
  } catch {
    return false;
  }
}

const KEY_TYPE: Record<JwsAlgorithm, Jwk["kty"]> = { RS256: "RSA", ES256: "EC" };

export async function verifyJws(
  token: string,
  jwks: JwksSource,
  algorithms: readonly JwsAlgorithm[],
): Promise<JwtClaims | null> {
  if (token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) {
    return null;
  }
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (!header || !payload || typeof header.kid !== "string") {
    return null;
  }
  const algorithm = algorithms.find((entry) => entry === header.alg);
  if (!algorithm) {
    return null;
  }
  const kid = header.kid;
  const jwk = (await jwks(kid)).find((key) => key.kid === kid && key.kty === KEY_TYPE[algorithm]);
  if (!jwk) {
    return null;
  }
  let signature: Bytes;
  try {
    signature = fromBase64Url(signaturePart);
  } catch {
    return null;
  }
  const valid = await verifyWith(jwk, signature, utf8Encode(`${headerPart}.${payloadPart}`));
  return valid ? payload : null;
}
