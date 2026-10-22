import { duplicateKey, type ItemDraft, type VaultItem } from "../vault.js";
import { countSkip, type ImportFormat, type ImportSource } from "./source.js";

export interface ImportPlan {
  format: ImportFormat;
  items: ItemDraft[];
  passkeysForExisting: VaultItem[];
  skipped: ImportSource["skipped"];
}

export function planImport(source: ImportSource, existing: VaultItem[]): ImportPlan {
  const plan: ImportPlan = {
    format: source.format,
    items: [],
    passkeysForExisting: [],
    skipped: { ...source.skipped },
  };
  const inVault = new Map(existing.map((item) => [duplicateKey(item), item]));
  const planned = new Map<string, ItemDraft>();
  const knownPasskeys = new Set(existing.flatMap((item) => item.passkey?.credentialId ?? []));

  for (const found of source.drafts) {
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
