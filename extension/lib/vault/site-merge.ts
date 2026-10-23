import { itemType } from "../item-types.js";
import { moveToTrash } from "../trash.js";
import { domainsOf, isOwnLogin, labelFromTitle, siteLabel } from "./site-match.js";
import { saveItem } from "./store.js";
import { isSharedVaultId } from "./vault-ids.js";
import type { VaultItem } from "./types.js";

export interface SiteMerge {
  domain: string;
  target: VaultItem;
  passkeyFrom?: VaultItem;
  codesFrom?: VaultItem;
}

function onlyPasskey(item: VaultItem): boolean {
  return (
    Boolean(item.passkey) &&
    !item.password &&
    !item.totp &&
    !item.fields?.length &&
    !item.codes?.length
  );
}

function ownRecovery(item: VaultItem): boolean {
  return itemType(item) === "recovery" && !isSharedVaultId(item.vault) && !item.trashedAt;
}

export function findSiteMerges(items: readonly VaultItem[]): SiteMerge[] {
  const byDomain = new Map<string, VaultItem[]>();
  for (const item of items.filter(isOwnLogin)) {
    const domain = domainsOf(item)[0];
    if (domain) {
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), item]);
    }
  }
  const recoveries = items.filter(ownRecovery);
  const merges: SiteMerge[] = [];
  for (const [domain, logins] of byDomain) {
    const withPassword = logins.filter((item) => item.password);
    const target = withPassword.length === 1 ? withPassword[0] : undefined;
    if (!target) {
      continue;
    }
    const passkeys = logins.filter((item) => item !== target && onlyPasskey(item));
    const codes = recoveries.filter((item) => labelFromTitle(item.title) === siteLabel(domain));
    const merge: SiteMerge = {
      domain,
      target,
      ...(!target.passkey && passkeys.length === 1 ? { passkeyFrom: passkeys[0] } : {}),
      ...(!target.codes?.length && codes.length === 1 ? { codesFrom: codes[0] } : {}),
    };
    if (merge.passkeyFrom || merge.codesFrom) {
      merges.push(merge);
    }
  }
  return merges;
}

export function mergedItem(merge: SiteMerge): VaultItem {
  const { target, passkeyFrom, codesFrom } = merge;
  const notes = [target, passkeyFrom, codesFrom]
    .map((item) => item?.note?.trim())
    .filter((note): note is string => Boolean(note));
  return {
    ...target,
    ...(passkeyFrom?.passkey ? { passkey: passkeyFrom.passkey } : {}),
    ...(codesFrom?.codes?.length
      ? {
          codes: codesFrom.codes,
          ...(codesFrom.usedCodes ? { usedCodes: codesFrom.usedCodes } : {}),
        }
      : {}),
    ...(notes.length > 0 ? { note: notes.join("\n\n") } : {}),
  };
}

export async function applySiteMerge(key: CryptoKey, merge: SiteMerge): Promise<void> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = mergedItem(merge);
  await saveItem(key, draft, merge.target);
  for (const donor of [merge.passkeyFrom, merge.codesFrom]) {
    if (donor) {
      await moveToTrash(key, donor);
    }
  }
}
