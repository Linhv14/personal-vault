import { open, seal, type SealedData } from "#core/crypto.js";
import { utf8Encode } from "#core/bytes.js";
import { createIdentity, type Identity } from "#core/identity.js";
import { ApiError, request } from "./api.js";
import { getLocal, setLocal } from "./storage.js";

interface StoredIdentity {
  publicKey: string;
  wrappedPrivateKey: SealedData;
}

async function fetchIdentity(): Promise<StoredIdentity | null> {
  const { identity } = await request<{ identity: StoredIdentity | null }>("/api/account/identity");
  if (identity) {
    await setLocal({ identity });
  }
  return identity;
}

const PRIVATE_KEY_CONTEXT = utf8Encode("personal-vault/account-private-key");

async function opened(vaultKey: CryptoKey, stored: StoredIdentity): Promise<Identity> {
  return {
    publicKey: stored.publicKey,
    privateKey: await open(vaultKey, stored.wrappedPrivateKey, PRIVATE_KEY_CONTEXT),
  };
}

export async function ensureIdentity(vaultKey: CryptoKey): Promise<Identity> {
  const stored = await fetchIdentity();
  if (stored) {
    return opened(vaultKey, stored);
  }
  const identity = await createIdentity();
  const wrappedPrivateKey = await seal(vaultKey, identity.privateKey, PRIVATE_KEY_CONTEXT);
  try {
    await request("/api/account/identity", {
      method: "PUT",
      body: JSON.stringify({ publicKey: identity.publicKey, wrappedPrivateKey }),
    });
    await setLocal({ identity: { publicKey: identity.publicKey, wrappedPrivateKey } });
    return identity;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) {
      throw error;
    }
    const winner = await fetchIdentity();
    if (!winner) {
      throw error;
    }
    return opened(vaultKey, winner);
  }
}

export async function knownIdentity(vaultKey: CryptoKey): Promise<Identity | null> {
  const cached = (await getLocal()).identity;
  if (cached) {
    return opened(vaultKey, cached);
  }
  const stored = await fetchIdentity();
  return stored ? opened(vaultKey, stored) : null;
}
