import { sealJson } from "../../../src/core/crypto.js";
import { registrableDomain } from "../../../src/core/site.js";
import * as api from "../api.js";
import { cardDigits, itemType } from "../item-types.js";
import { getLocal, setLocal } from "../storage.js";
import { itemAssociatedData } from "./item-crypto.js";
import { newItemId } from "./store.js";
import type { ItemDraft } from "./types.js";

const IMPORT_BATCH_SIZE = 100;

export function duplicateKey(item: ItemDraft): string {
  const title = item.title.trim().toLowerCase();
  switch (itemType(item)) {
    case "login": {
      const site = (item.url && registrableDomain(item.url)) || title;
      return [site, item.username ?? "", item.password ?? ""].join("\n");
    }
    case "card":
      return ["card", cardDigits(item.cardNumber) || title].join("\n");
    case "identity":
      return ["identity", title, item.fullName ?? "", item.email ?? ""].join("\n");
    case "wifi":
      return ["wifi", item.ssid ?? title, item.password ?? ""].join("\n");
    case "note":
      return ["note", title, item.note ?? ""].join("\n");
    case "recovery":
      return ["recovery", title, (item.codes ?? []).join("\n")].join("\n");
    case "api":
      return ["api", item.url ?? title, item.username ?? "", item.password ?? ""].join("\n");
    case "ssh":
      return ["ssh", item.sshFingerprint || item.sshPublicKey || title].join("\n");
    case "bank":
      return ["bank", item.accountNumber || item.iban || title].join("\n");
    case "document":
      return ["document", item.documentNumber || title].join("\n");
    case "license":
      return ["license", item.licenseKey || title].join("\n");
  }
}

export async function importItems(
  key: CryptoKey,
  drafts: ItemDraft[],
  onProgress: (saved: number) => void = () => {},
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let saved = 0;
  for (let start = 0; start < drafts.length; start += IMPORT_BATCH_SIZE) {
    const chunk = drafts.slice(start, start + IMPORT_BATCH_SIZE).map((draft) => ({
      ...draft,
      id: newItemId(),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    }));
    const sealed = await Promise.all(
      chunk.map(async (item) => ({
        id: item.id,
        ...(await sealJson(key, item, itemAssociatedData(item.id))),
      })),
    );
    const { updatedAt, created } = await api.createItems(sealed);
    const createdIds = new Set(created);
    const { items = [] } = await getLocal();
    await setLocal({
      items: [
        ...items,
        ...sealed
          .filter(({ id }) => createdIds.has(id))
          .map(({ id, ciphertext, nonce }) => ({
            id,
            ciphertext,
            nonce,
            updatedAt,
            deletedAt: null,
          })),
      ],
    });
    saved += createdIds.size;
    onProgress(saved);
  }
  return saved;
}
