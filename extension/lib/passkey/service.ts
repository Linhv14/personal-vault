import type { TrustedSender } from "../autofill-service.js";
import { itemType } from "../item-types.js";
import { getLocal, notePasskeys } from "../storage.js";
import {
  byLastUsed,
  markUsed,
  newItemId,
  openVault,
  registrableDomain,
  saveItem,
  type VaultItem,
} from "../vault.js";
import { createPasskey, signAssertion, type StoredPasskey } from "./authenticator.js";
import type {
  CreateResponse,
  GetResponse,
  PasskeyMessages,
  PasskeyRequest,
  PasskeyResponse,
  QueryResponse,
} from "./protocol.js";
import { resolveRpId } from "./relying-party.js";

interface SavedPasskey {
  item: VaultItem;
  passkey: StoredPasskey;
}

function passkeysFor(items: VaultItem[], rpId: string, allowed: string[]): SavedPasskey[] {
  return items.flatMap((item) => {
    const { passkey } = item;
    const listed = allowed.length === 0 || (passkey && allowed.includes(passkey.credentialId));
    return passkey?.rpId === rpId && listed ? [{ item, passkey }] : [];
  });
}

function itemFor(items: VaultItem[], origin: string, userName: string): VaultItem | undefined {
  const site = registrableDomain(origin);
  return items.find(
    (item) =>
      !item.passkey &&
      itemType(item) === "login" &&
      item.url !== undefined &&
      registrableDomain(item.url) === site &&
      (item.username ?? "") === userName,
  );
}

async function query(
  origin: string,
  {
    rpId: requested,
    allowCredentialIds,
    excludeCredentialIds = [],
  }: PasskeyMessages["passkey:query"]["request"],
): Promise<QueryResponse> {
  const rpId = resolveRpId(origin, requested);
  if (!rpId) return { ok: false, error: "invalid_rp" };
  const vault = await openVault();
  if (!vault) {
    const { hasPasskeys = true } = await getLocal();
    return { ok: true, state: "locked", hasPasskeys };
  }
  const passkeys = passkeysFor(vault.items, rpId, allowCredentialIds)
    .sort((a, b) => byLastUsed(a.item, b.item))
    .map(({ item, passkey }) => ({
      credentialId: passkey.credentialId,
      title: item.title,
      userName: passkey.userName,
    }));
  const excluded =
    excludeCredentialIds.length > 0 &&
    passkeysFor(vault.items, rpId, excludeCredentialIds).length > 0;
  return { ok: true, state: "ready", rpId, passkeys, excluded };
}

async function create(
  origin: string,
  { options }: PasskeyMessages["passkey:create"]["request"],
): Promise<CreateResponse> {
  const rpId = resolveRpId(origin, options.rpId);
  if (!rpId) return { ok: false, error: "invalid_rp" };
  const vault = await openVault();
  if (!vault) return { ok: false, error: "locked" };
  const excluded = options.excludeCredentialIds;
  if (excluded.length > 0 && passkeysFor(vault.items, rpId, excluded).length > 0) {
    return { ok: false, error: "excluded" };
  }

  const { registration, passkey } = await createPasskey({
    rpId,
    origin,
    challenge: options.challenge,
    userHandle: options.userId,
    userName: options.userName,
    userDisplayName: options.userDisplayName,
  });
  const existing = itemFor(vault.items, origin, options.userName);
  await saveItem(
    vault.key,
    existing
      ? { ...existing, passkey }
      : {
          id: newItemId(),
          title: options.rpName || rpId,
          url: rpId,
          username: options.userName,
          passkey,
        },
  );
  await notePasskeys(true);
  return { ok: true, registration };
}

async function get(
  origin: string,
  { options, credentialId }: PasskeyMessages["passkey:get"]["request"],
): Promise<GetResponse> {
  const rpId = resolveRpId(origin, options.rpId);
  if (!rpId) return { ok: false, error: "invalid_rp" };
  const vault = await openVault();
  if (!vault) return { ok: false, error: "locked" };
  const match = passkeysFor(vault.items, rpId, options.allowCredentialIds).find(
    ({ passkey }) => passkey.credentialId === credentialId,
  );
  if (!match) return { ok: false, error: "not_found" };
  const assertion = await signAssertion(match.passkey, { origin, challenge: options.challenge });
  await markUsed(vault.key, match.item).catch(() => {});
  return { ok: true, assertion };
}

export async function handlePasskey(
  request: PasskeyRequest,
  sender: TrustedSender,
): Promise<PasskeyResponse> {
  const origin = new URL(sender.url).origin;
  switch (request.type) {
    case "passkey:query":
      return query(origin, request);
    case "passkey:create":
      return create(origin, request);
    case "passkey:get":
      return get(origin, request);
    case "passkey:open-popup":
      await chrome.action.openPopup?.().catch(() => {});
      return { ok: true };
  }
}
