export const ES256 = -7;

export interface PasskeyOption {
  credentialId: string;
  title: string;
  userName: string;
}

export interface CreateOptions {
  rpId?: string;
  rpName?: string;
  challenge: string;
  userId: string;
  userName: string;
  userDisplayName?: string;
  excludeCredentialIds: string[];
}

export interface GetOptions {
  rpId?: string;
  challenge: string;
  allowCredentialIds: string[];
}

export type PasskeyRequest =
  | { type: "passkey:query-create"; options: CreateOptions }
  | { type: "passkey:query-get"; options: GetOptions }
  | { type: "passkey:create"; options: CreateOptions }
  | { type: "passkey:get"; options: GetOptions; credentialId: string }
  | { type: "passkey:open-popup" };

export interface RegistrationJSON {
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  authenticatorData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
}

export interface AssertionJSON {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string;
}

export type PasskeyError = "locked" | "invalid_rp" | "excluded" | "not_found" | "unsupported";

export type PasskeyResponse =
  | { ok: true; locked: true }
  | { ok: true; locked: false; rpId: string; passkeys: PasskeyOption[] }
  | { ok: true; registration: RegistrationJSON }
  | { ok: true; assertion: AssertionJSON }
  | { ok: true }
  | { ok: false; error: PasskeyError | string };

export function isPasskeyRequest(message: unknown): message is PasskeyRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === "string" && type.startsWith("passkey:");
}

export const PAGE_REQUEST = "1pw-passkey-request";
export const PAGE_REPLY = "1pw-passkey-reply";
export const PAGE_ABORT = "1pw-passkey-abort";

export type PageRequest =
  { kind: "create"; options: CreateOptions } | { kind: "get"; options: GetOptions };

export type PageReply =
  | { kind: "fallback" }
  | { kind: "error"; name: string; message: string }
  | { kind: "registration"; registration: RegistrationJSON; credProps: boolean }
  | { kind: "assertion"; assertion: AssertionJSON };
