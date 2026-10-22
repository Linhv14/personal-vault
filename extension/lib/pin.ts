import { fromBase64, randomBytes, toBase64, utf8Encode, type Bytes } from "../../src/core/bytes.js";
import { asSession, request } from "./api.js";
import { forget, openVaultKey, rejection, sealVaultKey, signedInSession } from "./device-unlock.js";
import { getLocal, setLocal, unlock } from "./storage.js";

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;
const PIN_ITERATIONS = 300_000;
const PIN_PATTERN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

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
  return PIN_PATTERN.test(pin);
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

export async function hasPin(): Promise<boolean> {
  return Boolean((await getLocal()).pin);
}

export async function enablePin(pin: string, iterations = PIN_ITERATIONS): Promise<void> {
  if (!isValidPin(pin)) {
    throw new PinError("invalid");
  }
  const session = await signedInSession();
  const salt = randomBytes(16);
  const { verifier, local } = await derive(pin, salt, iterations);
  const { pinKey } = await request<{ pinKey: string }>("/api/auth/pin", {
    method: "PUT",
    body: JSON.stringify({ verifier }),
  });
  const sealed = await sealVaultKey("pin", pinKey, local, session.vaultKeyRaw);
  await setLocal({ pin: { token: session.token, salt: toBase64(salt), iterations, sealed } });
}

export async function disablePin(): Promise<void> {
  const { pin } = await getLocal();
  await forget("pin");
  if (pin) {
    await request("/api/auth/pin", { method: "DELETE", ...asSession(pin.token) }).catch(() => {});
  }
}

export async function unlockWithPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) {
    throw new PinError("invalid");
  }
  const { pin: stored } = await getLocal();
  if (!stored) {
    throw new PinError("off");
  }
  const { verifier, local } = await derive(pin, fromBase64(stored.salt), stored.iterations);
  const pinKey = await request<{ pinKey: string }>("/api/auth/pin/unlock", {
    method: "POST",
    body: JSON.stringify({ verifier }),
    ...asSession(stored.token),
  }).then(
    (response) => response.pinKey,
    async (error: unknown) => {
      const reason = rejection(error);
      if (reason === "denied") {
        const params = (error as { params: Record<string, unknown> }).params;
        throw new PinError("wrong", Number(params.count ?? 0));
      }
      if (reason === "gone") {
        await forget("pin");
        throw new PinError("off");
      }
      throw error;
    },
  );
  const vaultKeyRaw = await openVaultKey("pin", pinKey, local, stored.sealed);
  await unlock(vaultKeyRaw, stored.token);
  return vaultKeyRaw;
}
