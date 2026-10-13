import type { TrustedSender } from "../autofill-service.js";
import { getUnlocked } from "../storage.js";
import {
  decryptAll,
  importKey,
  newItemId,
  registrableDomain,
  saveItem,
  type VaultItem,
} from "../vault.js";
import { createPasskey, signAssertion, type StoredPasskey } from "./authenticator.js";
import type { PasskeyOption, PasskeyRequest, PasskeyResponse } from "./protocol.js";
import { resolveRpId } from "./relying-party.js";

async function unlocked(): Promise<{ key: CryptoKey; items: VaultItem[] } | null> {
  const session = await getUnlocked();
  if (!session) return null;
  const key = await importKey(session.vaultKeyRaw);
  return { key, items: await decryptAll(key) };
}

interface SavedPasskey {
  item: VaultItem;
  passkey: StoredPasskey;
}

function passkeysFor(items: VaultItem[], rpId: string, allowed: string[]): SavedPasskey[] {
  return items.flatMap(({ passkey, ...rest }) =>
    passkey?.rpId === rpId && (allowed.length === 0 || allowed.includes(passkey.credentialId))
      ? [{ item: { ...rest, passkey }, passkey }]
      : [],
  );
}

function option({ item, passkey }: SavedPasskey): PasskeyOption {
  return { credentialId: passkey.credentialId, title: item.title, userName: passkey.userName };
}

function homeItem(items: VaultItem[], origin: string, userName: string): VaultItem | undefined {
  const site = registrableDomain(origin);
  return items.find(
    (item) =>
      !item.passkey &&
      item.url !== undefined &&
      registrableDomain(item.url) === site &&
      (item.username ?? "") === userName,
  );
}

export async function handlePasskey(
  request: PasskeyRequest,
  sender: TrustedSender,
): Promise<PasskeyResponse> {
  const origin = new URL(sender.url).origin;
  if (request.type === "passkey:open-popup") {
    await chrome.action.openPopup?.().catch(() => {});
    return { ok: true };
  }

  const rpId = resolveRpId(origin, request.options.rpId);
  if (!rpId) return { ok: false, error: "invalid_rp" };
  const vault = await unlocked();

  switch (request.type) {
    case "passkey:query-create":
    case "passkey:query-get": {
      if (!vault) return { ok: true, locked: true };
      const allowed =
        request.type === "passkey:query-get" ? request.options.allowCredentialIds : [];
      return {
        ok: true,
        locked: false,
        rpId,
        passkeys: passkeysFor(vault.items, rpId, allowed).map(option),
      };
    }

    case "passkey:create": {
      if (!vault) return { ok: false, error: "locked" };
      const { options } = request;
      if (
        options.excludeCredentialIds.length > 0 &&
        passkeysFor(vault.items, rpId, options.excludeCredentialIds).length > 0
      ) {
        return { ok: false, error: "excluded" };
      }
      const result = await createPasskey({
        rpId,
        origin,
        challenge: options.challenge,
        userHandle: options.userId,
        userName: options.userName,
        userDisplayName: options.userDisplayName,
      });
      const existing = homeItem(vault.items, origin, options.userName);
      await saveItem(
        vault.key,
        existing
          ? { ...existing, passkey: result.passkey }
          : {
              id: newItemId(),
              title: options.rpName || rpId,
              url: rpId,
              username: options.userName,
              passkey: result.passkey,
            },
      );
      return {
        ok: true,
        registration: {
          credentialId: result.credentialId,
          clientDataJSON: result.clientDataJSON,
          attestationObject: result.attestationObject,
          authenticatorData: result.authenticatorData,
          publicKey: result.publicKey,
          publicKeyAlgorithm: result.publicKeyAlgorithm,
        },
      };
    }

    case "passkey:get": {
      if (!vault) return { ok: false, error: "locked" };
      const match = passkeysFor(vault.items, rpId, request.options.allowCredentialIds).find(
        ({ passkey }) => passkey.credentialId === request.credentialId,
      );
      if (!match) return { ok: false, error: "not_found" };
      return {
        ok: true,
        assertion: await signAssertion(match.passkey, {
          origin,
          challenge: request.options.challenge,
        }),
      };
    }
  }
}
