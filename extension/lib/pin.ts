import { openJson, sealJson } from "../../src/core/crypto.js";
import {
  concat,
  fromBase64,
  randomBytes,
  toBase64,
  utf8Encode,
  type Bytes,
} from "../../src/core/bytes.js";
import * as api from "./api.js";
import { getLocal, getUnlocked, setLocal, unlock } from "./storage.js";

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;
export const PIN_ITERATIONS = 300_000;
const PIN_CONTEXT = utf8Encode("personal-vault/pin");

export class PinError extends Error {
  constructor(
    readonly code: "wrong" | "off" | "invalid",
    readonly attemptsLeft = 0,
  ) {
    super(`pin ${code}`);
    this.name = "PinError";
  }
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

async function derive(pin: string, salt: Bytes, iterations: number) {
  const base = await crypto.subtle.importKey("raw", utf8Encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      base,
      512,
    ),
  );
  return { verifier: toBase64(bits.slice(0, 32)), local: bits.slice(32) };
}

async function wrappingKey(pinKey: string, local: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    concat(fromBase64(pinKey), local),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: PIN_CONTEXT },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function hasPin(): Promise<boolean> {
  return Boolean((await getLocal()).pin);
}

export async function enablePin(pin: string, iterations = PIN_ITERATIONS): Promise<void> {
  if (!isValidPin(pin)) throw new PinError("invalid");
  const session = await getUnlocked();
  if (!session?.token) throw new api.ApiError("error.api.not_signed_in", 401);
  const salt = randomBytes(16);
  const { verifier, local } = await derive(pin, salt, iterations);
  const pinKey = await api.setPin(verifier);
  const sealed = await sealJson(
    await wrappingKey(pinKey, local),
    { vaultKeyRaw: session.vaultKeyRaw },
    PIN_CONTEXT,
  );
  await setLocal({ pin: { token: session.token, salt: toBase64(salt), iterations, sealed } });
}

export async function disablePin(): Promise<void> {
  const { pin } = await getLocal();
  await chrome.storage.local.remove("pin");
  if (pin) await api.clearPin(pin.token).catch(() => {});
}

export async function unlockWithPin(pin: string): Promise<string> {
  const { pin: stored } = await getLocal();
  if (!stored) throw new PinError("off");
  const { verifier, local } = await derive(pin, fromBase64(stored.salt), stored.iterations);
  let pinKey: string;
  try {
    pinKey = await api.pinUnlock(stored.token, verifier);
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 403) {
      throw new PinError("wrong", Number(error.params.count ?? 0));
    }
    if (error instanceof api.ApiError && (error.status === 410 || error.status === 401)) {
      await chrome.storage.local.remove("pin");
      throw new PinError("off");
    }
    throw error;
  }
  const { vaultKeyRaw } = await openJson<{ vaultKeyRaw: string }>(
    await wrappingKey(pinKey, local),
    stored.sealed,
    PIN_CONTEXT,
  );
  await unlock(vaultKeyRaw, stored.token);
  return vaultKeyRaw;
}
