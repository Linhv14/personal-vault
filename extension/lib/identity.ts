import { open, seal, type SealedData } from "../../src/core/crypto.js";
import { utf8Encode } from "../../src/core/bytes.js";
import { createIdentity, type Identity } from "../../src/core/identity.js";
import * as api from "./api.js";

const PRIVATE_KEY_CONTEXT = utf8Encode("personal-vault/account-private-key");

async function opened(
  vaultKey: CryptoKey,
  stored: { publicKey: string; wrappedPrivateKey: SealedData },
): Promise<Identity> {
  return {
    publicKey: stored.publicKey,
    privateKey: await open(vaultKey, stored.wrappedPrivateKey, PRIVATE_KEY_CONTEXT),
  };
}

export async function ensureIdentity(vaultKey: CryptoKey): Promise<Identity> {
  const stored = await api.getIdentity();
  if (stored) return opened(vaultKey, stored);
  const identity = await createIdentity();
  const wrappedPrivateKey = await seal(vaultKey, identity.privateKey, PRIVATE_KEY_CONTEXT);
  try {
    await api.putIdentity(identity.publicKey, wrappedPrivateKey);
    return identity;
  } catch (error) {
    if (!(error instanceof api.ApiError) || error.status !== 409) throw error;
    const winner = await api.getIdentity();
    if (!winner) throw error;
    return opened(vaultKey, winner);
  }
}
