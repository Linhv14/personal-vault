import {
  ES256,
  PAGE_ABORT,
  PAGE_REPLY,
  PAGE_REQUEST,
  type AssertionJSON,
  type PageReply,
  type PageRequest,
  type RegistrationJSON,
} from "../lib/passkey/protocol.js";
import { fromBase64Url, toBase64Url } from "../lib/passkey/base64url.js";

const credentials = navigator.credentials;
const nativeCreate = credentials.create.bind(credentials);
const nativeGet = credentials.get.bind(credentials);

function bytesOf(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function encode(source: BufferSource): string {
  return toBase64Url(bytesOf(source));
}

function buffer(value: string): ArrayBuffer {
  return fromBase64Url(value).buffer;
}

function define<T extends object>(target: T, values: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(target, key, { value, enumerable: true });
  }
  return target;
}

function ask(request: PageRequest, signal?: AbortSignal | null): Promise<PageReply> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onReply = (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== PAGE_REPLY || event.data.id !== id)
        return;
      cleanup();
      resolve(event.data.reply as PageReply);
    };
    const onAbort = () => {
      cleanup();
      window.postMessage({ type: PAGE_ABORT, id }, location.origin);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const cleanup = () => {
      window.removeEventListener("message", onReply);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal?.aborted) return onAbort();
    window.addEventListener("message", onReply);
    signal?.addEventListener("abort", onAbort);
    window.postMessage({ type: PAGE_REQUEST, id, request }, location.origin);
  });
}

function registrationCredential(json: RegistrationJSON, wantsCredProps: boolean): Credential {
  const extensions = wantsCredProps ? { credProps: { rk: true } } : {};
  const response = define(Object.create(AuthenticatorAttestationResponse.prototype), {
    clientDataJSON: buffer(json.clientDataJSON),
    attestationObject: buffer(json.attestationObject),
    getTransports: () => ["internal", "hybrid"],
    getPublicKey: () => buffer(json.publicKey),
    getPublicKeyAlgorithm: () => json.publicKeyAlgorithm,
    getAuthenticatorData: () => buffer(json.authenticatorData),
  });
  return define(Object.create(PublicKeyCredential.prototype), {
    id: json.credentialId,
    rawId: buffer(json.credentialId),
    type: "public-key",
    authenticatorAttachment: "platform",
    response,
    getClientExtensionResults: () => extensions,
    toJSON: () => ({
      id: json.credentialId,
      rawId: json.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: extensions,
      response: {
        clientDataJSON: json.clientDataJSON,
        attestationObject: json.attestationObject,
        authenticatorData: json.authenticatorData,
        publicKey: json.publicKey,
        publicKeyAlgorithm: json.publicKeyAlgorithm,
        transports: ["internal", "hybrid"],
      },
    }),
  });
}

function assertionCredential(json: AssertionJSON): Credential {
  const response = define(Object.create(AuthenticatorAssertionResponse.prototype), {
    clientDataJSON: buffer(json.clientDataJSON),
    authenticatorData: buffer(json.authenticatorData),
    signature: buffer(json.signature),
    userHandle: buffer(json.userHandle),
  });
  return define(Object.create(PublicKeyCredential.prototype), {
    id: json.credentialId,
    rawId: buffer(json.credentialId),
    type: "public-key",
    authenticatorAttachment: "platform",
    response,
    getClientExtensionResults: () => ({}),
    toJSON: () => ({
      id: json.credentialId,
      rawId: json.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: json.clientDataJSON,
        authenticatorData: json.authenticatorData,
        signature: json.signature,
        userHandle: json.userHandle,
      },
    }),
  });
}

function failure(reply: Extract<PageReply, { kind: "error" }>): DOMException {
  return new DOMException(reply.message, reply.name);
}

credentials.create = async function create(options?: CredentialCreationOptions) {
  const publicKey = options?.publicKey;
  if (!publicKey || !publicKey.pubKeyCredParams.some((param) => param.alg === ES256)) {
    return nativeCreate(options);
  }
  const reply = await ask(
    {
      kind: "create",
      options: {
        rpId: publicKey.rp.id,
        rpName: publicKey.rp.name,
        challenge: encode(publicKey.challenge),
        userId: encode(publicKey.user.id),
        userName: publicKey.user.name,
        userDisplayName: publicKey.user.displayName,
        excludeCredentialIds: (publicKey.excludeCredentials ?? []).map(({ id }) => encode(id)),
      },
    },
    options?.signal,
  );
  if (reply.kind === "fallback") return nativeCreate(options);
  if (reply.kind === "error") throw failure(reply);
  if (reply.kind !== "registration") throw new DOMException("Unexpected reply", "UnknownError");
  return registrationCredential(
    reply.registration,
    Boolean((publicKey.extensions as { credProps?: boolean } | undefined)?.credProps),
  );
};

credentials.get = async function get(options?: CredentialRequestOptions) {
  const publicKey = options?.publicKey;
  if (!publicKey || options?.mediation === "conditional") return nativeGet(options);
  const reply = await ask(
    {
      kind: "get",
      options: {
        rpId: publicKey.rpId,
        challenge: encode(publicKey.challenge),
        allowCredentialIds: (publicKey.allowCredentials ?? []).map(({ id }) => encode(id)),
      },
    },
    options?.signal,
  );
  if (reply.kind === "fallback") return nativeGet(options);
  if (reply.kind === "error") throw failure(reply);
  if (reply.kind !== "assertion") throw new DOMException("Unexpected reply", "UnknownError");
  return assertionCredential(reply.assertion);
};
