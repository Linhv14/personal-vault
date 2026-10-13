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

type Failure<E extends string> = { ok: false; error: E | "invalid_rp" | "unavailable" };

export type QueryResponse =
  | { ok: true; state: "locked" }
  | { ok: true; state: "ready"; rpId: string; passkeys: PasskeyOption[] }
  | Failure<never>;
export type CreateResponse =
  { ok: true; registration: RegistrationJSON } | Failure<"locked" | "excluded">;
export type GetResponse = { ok: true; assertion: AssertionJSON } | Failure<"locked" | "not_found">;

export interface PasskeyMessages {
  "passkey:query": {
    request: { rpId?: string; allowCredentialIds: string[] };
    response: QueryResponse;
  };
  "passkey:create": { request: { options: CreateOptions }; response: CreateResponse };
  "passkey:get": { request: { options: GetOptions; credentialId: string }; response: GetResponse };
  "passkey:open-popup": { request: Record<never, never>; response: { ok: true } };
}

export type PasskeyRequest = {
  [K in keyof PasskeyMessages]: { type: K } & PasskeyMessages[K]["request"];
}[keyof PasskeyMessages];

export type PasskeyResponse = PasskeyMessages[keyof PasskeyMessages]["response"];

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
  | { kind: "registration"; registration: RegistrationJSON }
  | { kind: "assertion"; assertion: AssertionJSON };
