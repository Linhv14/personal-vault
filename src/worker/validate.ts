import { fromBase64 } from "../core/bytes.js";
import type { SealedData } from "../core/crypto.js";
import type { WrappedKey } from "../core/org-model.js";
import { MAX_PROJECT_BYTES, MAX_SECRET_BYTES } from "../core/projects.js";
import { MAX_TEAM_ITEM_BYTES } from "../core/team-items.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isBase64(value: unknown, maxBytes = 4096): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  try {
    return fromBase64(value).length <= maxBytes;
  } catch {
    return false;
  }
}

export function isBase64Url(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isSealed(
  value: unknown,
  maxBytes = 4096,
): value is { ciphertext: string; nonce: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { ciphertext, nonce } = value as Record<string, unknown>;
  return isBase64(ciphertext, maxBytes) && isBase64(nonce, 12);
}

export function isWrappedKey(value: unknown): value is WrappedKey {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { ephemeralPublicKey, sealed } = value as Record<string, unknown>;
  return isBase64(ephemeralPublicKey, 128) && isSealed(sealed, 256);
}

export function displayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 80 && !/\p{Cc}/u.test(name) ? name : null;
}

export function isSealedProject(value: unknown): value is SealedData {
  return isSealed(value, MAX_PROJECT_BYTES);
}

export function isSealedSecret(value: unknown): value is SealedData {
  return isSealed(value, MAX_SECRET_BYTES);
}

export function isSealedTeamItem(value: unknown): value is SealedData {
  return isSealed(value, MAX_TEAM_ITEM_BYTES);
}
