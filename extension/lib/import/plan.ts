import { itemType } from "../item-types.js";
import { duplicateKey } from "../vault/import-items.js";
import { loginForCodes } from "../vault/site-match.js";
import type { ItemDraft, VaultItem } from "../vault/types.js";
import { countSkip, type ImportFormat, type ImportSource } from "./source.js";

export interface ImportPlan {
  format: ImportFormat;
  items: ItemDraft[];
  passkeysForExisting: VaultItem[];
  codesForExisting: VaultItem[];
  skipped: ImportSource["skipped"];
}

export function planImport(source: ImportSource, existing: VaultItem[]): ImportPlan {
  const plan: ImportPlan = {
    format: source.format,
    items: [],
    passkeysForExisting: [],
    codesForExisting: [],
    skipped: { ...source.skipped },
  };
  const inVault = new Map(existing.map((item) => [duplicateKey(item), item]));
  const planned = new Map<string, ItemDraft>();
  const knownPasskeys = new Set(existing.flatMap((item) => item.passkey?.credentialId ?? []));

  const withCodes = new Map<string, VaultItem>();

  for (const found of source.drafts) {
    if (itemType(found) === "recovery" && found.codes?.length) {
      const owner = loginForCodes(
        existing.map((item) => withCodes.get(item.id) ?? item),
        found.title,
      );
      if (owner) {
        const updated = { ...owner, codes: found.codes };
        withCodes.set(owner.id, updated);
        plan.codesForExisting.push(updated);
        continue;
      }
    }
    const passkey =
      found.passkey && !knownPasskeys.has(found.passkey.credentialId) ? found.passkey : undefined;
    if (passkey) {
      knownPasskeys.add(passkey.credentialId);
    }
    const draft = { ...found, passkey };
    const key = duplicateKey(draft);
    const saved = inVault.get(key);
    const pending = planned.get(key);

    if (saved && passkey && !saved.passkey) {
      const updated = { ...saved, passkey };
      inVault.set(key, updated);
      plan.passkeysForExisting.push(updated);
    } else if (pending && passkey && !pending.passkey) {
      pending.passkey = passkey;
    } else if (saved || pending) {
      countSkip(plan.skipped, "duplicate");
    } else {
      planned.set(key, draft);
      plan.items.push(draft);
    }
  }
  return plan;
}
