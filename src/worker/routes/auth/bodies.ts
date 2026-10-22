import { isBase64 } from "../../validate.js";

export const MIN_KDF_ITERATIONS = 600_000;

interface SealedBody {
  ciphertext: string;
  nonce: string;
}

export function isSealed(value: unknown, maxBytes = 4096): value is SealedBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { ciphertext, nonce } = value as Record<string, unknown>;
  return isBase64(ciphertext, maxBytes) && isBase64(nonce, 12);
}

export interface KdfBody {
  type: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

export function isKdf(value: unknown): value is KdfBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { type, iterations, salt } = value as Record<string, unknown>;
  return (
    type === "pbkdf2-sha256" &&
    typeof iterations === "number" &&
    iterations >= MIN_KDF_ITERATIONS &&
    iterations <= 5_000_000 &&
    isBase64(salt, 64)
  );
}
