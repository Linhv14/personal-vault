import { fromBase64, fromBase64Url, randomBytes, toBase64, toBase64Url } from "#core/bytes.js";
import type { MessageKey } from "#i18n/index.js";
import { asSession, request } from "./api.js";
import { forget, openVaultKey, rejection, sealVaultKey, signedInSession } from "./device-unlock.js";
import { getLocal, setLocal, unlock } from "./storage.js";

const TIMEOUT_MS = 60_000;
const ES256 = -7;
const RS256 = -257;

export type BiometricKind = "touch-id" | "windows-hello" | "chromeos" | "screen-lock";

const LABEL: Record<BiometricKind, MessageKey> = {
  "touch-id": "bio.touch_id",
  "windows-hello": "bio.windows_hello",
  chromeos: "bio.chromeos",
  "screen-lock": "bio.screen_lock",
};

const SETUP: Record<BiometricKind, MessageKey> = {
  "touch-id": "bio.setup_mac",
  "windows-hello": "bio.setup_windows",
  chromeos: "bio.setup_chromeos",
  "screen-lock": "bio.setup_other",
};

export function biometricLabel(): MessageKey {
  return LABEL[biometricKind()];
}

export function biometricSetupHint(): MessageKey {
  return SETUP[biometricKind()];
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
  if (/mac/i.test(platform)) {
    return "touch-id";
  }
  if (/win/i.test(platform)) {
    return "windows-hello";
  }
  if (/cros|chrome ?os/i.test(platform)) {
    return "chromeos";
  }
  return "screen-lock";
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
  const session = await signedInSession();
  if (!(await biometricSupported())) {
    throw new BiometricError("unsupported");
  }
  const { email = "7key" } = await getLocal();
  const credential = (await navigator.credentials
    .create({
      publicKey: {
        rp: { name: "7key" },
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
  if (!credential) {
    throw new BiometricError("cancelled");
  }
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey();
  if (!publicKey) {
    throw new BiometricError("unsupported");
  }
  const { bioKey } = await request<{ bioKey: string }>("/api/auth/biometric", {
    method: "PUT",
    body: JSON.stringify({
      credentialId: credential.id,
      publicKey: toBase64Url(new Uint8Array(publicKey)),
      algorithm: response.getPublicKeyAlgorithm(),
      rpId: location.hostname,
      origin: location.origin,
    }),
  });
  const secret = randomBytes(32);
  const sealed = await sealVaultKey("biometric", bioKey, secret, session.vaultKeyRaw);
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
  await forget("biometric");
  if (biometric) {
    await request("/api/auth/biometric", { method: "DELETE", ...asSession(biometric.token) }).catch(
      () => {},
    );
  }
}

async function server<T>(path: string, token: string, body?: unknown): Promise<T> {
  try {
    return await request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...asSession(token),
    });
  } catch (error) {
    const reason = rejection(error);
    if (reason === "gone") {
      await forget("biometric");
      throw new BiometricError("off");
    }
    if (reason === "denied") {
      throw new BiometricError("failed");
    }
    throw error;
  }
}

let pending: Promise<string> | null = null;

export function unlockWithBiometric(): Promise<string> {
  pending ??= attemptUnlock().finally(() => {
    pending = null;
  });
  return pending;
}

async function attemptUnlock(): Promise<string> {
  const { biometric } = await getLocal();
  if (!biometric) {
    throw new BiometricError("off");
  }
  const { challenge } = await server<{ challenge: string }>(
    "/api/auth/biometric/challenge",
    biometric.token,
  );
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
  if (!credential) {
    throw new BiometricError("cancelled");
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  const { bioKey } = await server<{ bioKey: string }>(
    "/api/auth/biometric/unlock",
    biometric.token,
    {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
    },
  );
  const vaultKeyRaw = await openVaultKey(
    "biometric",
    bioKey,
    fromBase64(biometric.secret),
    biometric.sealed,
  );
  await unlock(vaultKeyRaw, biometric.token);
  return vaultKeyRaw;
}
