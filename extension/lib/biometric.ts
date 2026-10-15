import { openJson, sealJson } from "../../src/core/crypto.js";
import {
  fromBase64,
  fromBase64Url,
  randomBytes,
  toBase64,
  toBase64Url,
  utf8Encode,
} from "../../src/core/bytes.js";
import type { MessageKey } from "../../src/i18n/index.js";
import * as api from "./api.js";
import { deviceWrappingKey } from "./device-key.js";
import { getLocal, getUnlocked, setLocal, unlock } from "./storage.js";

const PURPOSE = "personal-vault/biometric";
const CONTEXT = utf8Encode(PURPOSE);
const TIMEOUT_MS = 60_000;
const ES256 = -7;
const RS256 = -257;

export type BiometricKind = "touch-id" | "windows-hello" | "biometrics";

const LABEL: Record<BiometricKind, MessageKey> = {
  "touch-id": "bio.touch_id",
  "windows-hello": "bio.windows_hello",
  biometrics: "bio.biometrics",
};

export function biometricLabel(): MessageKey {
  return LABEL[biometricKind()];
}

export class BiometricError extends Error {
  constructor(readonly code: "off" | "cancelled" | "failed" | "unsupported") {
    super(`biometric ${code}`);
    this.name = "BiometricError";
  }
}

function biometricKind(): BiometricKind {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform;
  if (/mac/i.test(platform)) return "touch-id";
  if (/win/i.test(platform)) return "windows-hello";
  return "biometrics";
}

export async function biometricSupported(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export async function hasBiometric(): Promise<boolean> {
  return Boolean((await getLocal()).biometric);
}

function asCancelled(error: unknown): never {
  if (error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)) {
    throw new BiometricError("cancelled");
  }
  throw error;
}

export async function enableBiometric(): Promise<void> {
  const session = await getUnlocked();
  if (!session?.token) throw new api.ApiError("error.api.not_signed_in", 401);
  if (!(await biometricSupported())) throw new BiometricError("unsupported");
  const { email = "1PW" } = await getLocal();
  const credential = (await navigator.credentials
    .create({
      publicKey: {
        rp: { name: "1PW" },
        user: { id: randomBytes(16), name: email, displayName: email },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: ES256 },
          { type: "public-key", alg: RS256 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        attestation: "none",
        timeout: TIMEOUT_MS,
      },
    })
    .catch(asCancelled)) as PublicKeyCredential | null;
  if (!credential) throw new BiometricError("cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey();
  if (!publicKey) throw new BiometricError("unsupported");
  const bioKey = await api.setBiometric({
    credentialId: credential.id,
    publicKey: toBase64Url(new Uint8Array(publicKey)),
    algorithm: response.getPublicKeyAlgorithm(),
    rpId: location.hostname,
    origin: location.origin,
  });
  const secret = randomBytes(32);
  const sealed = await sealJson(
    await deviceWrappingKey(bioKey, secret, PURPOSE),
    { vaultKeyRaw: session.vaultKeyRaw },
    CONTEXT,
  );
  await setLocal({
    biometric: {
      token: session.token,
      credentialId: credential.id,
      secret: toBase64(secret),
      sealed,
    },
  });
}

export async function disableBiometric(): Promise<void> {
  const { biometric } = await getLocal();
  await chrome.storage.local.remove("biometric");
  if (biometric) await api.clearBiometric(biometric.token).catch(() => {});
}

async function forgetWhenGone<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof api.ApiError && (error.status === 410 || error.status === 401)) {
      await chrome.storage.local.remove("biometric");
      throw new BiometricError("off");
    }
    if (error instanceof api.ApiError && error.status === 403) throw new BiometricError("failed");
    throw error;
  }
}

export async function unlockWithBiometric(): Promise<string> {
  const { biometric } = await getLocal();
  if (!biometric) throw new BiometricError("off");
  const { challenge } = await forgetWhenGone(api.biometricChallenge(biometric.token));
  const credential = (await navigator.credentials
    .get({
      publicKey: {
        challenge: fromBase64Url(challenge),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: fromBase64Url(biometric.credentialId) }],
        userVerification: "required",
        timeout: TIMEOUT_MS,
      },
    })
    .catch(asCancelled)) as PublicKeyCredential | null;
  if (!credential) throw new BiometricError("cancelled");
  const response = credential.response as AuthenticatorAssertionResponse;
  const bioKey = await forgetWhenGone(
    api.biometricUnlock(biometric.token, {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
    }),
  );
  const { vaultKeyRaw } = await openJson<{ vaultKeyRaw: string }>(
    await deviceWrappingKey(bioKey, fromBase64(biometric.secret), PURPOSE),
    biometric.sealed,
    CONTEXT,
  );
  await unlock(vaultKeyRaw, biometric.token);
  return vaultKeyRaw;
}
