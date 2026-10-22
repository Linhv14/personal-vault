import type { CardData, CardSuggestion } from "../autofill-protocol.js";
import { fillCardFrames } from "../card-frames.js";
import { cardBrand, cardDigits, itemType, lastFour } from "../item-types.js";
import { openVault, type OpenVault } from "../vault/decrypt.js";
import { byLastUsed } from "../vault/search.js";
import { markUsed } from "../vault/store.js";
import type { VaultItem } from "../vault/types.js";
import type { AutofillHandlers } from "./handler.js";
import { formsAllowed } from "./senders.js";

function isCard(item: VaultItem): boolean {
  return itemType(item) === "card" && cardDigits(item.cardNumber).length > 0;
}

function cardSuggestionOf(item: VaultItem, vault: OpenVault): CardSuggestion {
  const shared = vault.sharedName(item);
  return {
    id: item.id,
    title: item.title,
    brand: cardBrand(item.cardNumber),
    last4: lastFour(item.cardNumber),
    ...(shared ? { vault: shared } : {}),
  };
}

export const cardHandlers: AutofillHandlers<"autofill:cards" | "autofill:card"> = {
  "autofill:cards": async (_request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: true, locked: false, cards: [] };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const cards = vault.items
      .filter(isCard)
      .sort(byLastUsed)
      .map((item) => cardSuggestionOf(item, vault));
    return { ok: true, locked: false, cards };
  },

  "autofill:card": async (request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: false, error: "no_match" };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const item = vault.items.find((candidate) => candidate.id === request.id);
    if (!item || !isCard(item)) {
      return { ok: false, error: "no_match" };
    }
    void markUsed(vault.key, item).catch(() => {});
    const card: CardData = {
      number: cardDigits(item.cardNumber),
      brand: cardBrand(item.cardNumber),
      ...(item.cardholder ? { cardholder: item.cardholder } : {}),
      ...(item.cardExpiry ? { expiry: item.cardExpiry } : {}),
      ...(item.cardCvv ? { cvv: item.cardCvv } : {}),
    };
    await fillCardFrames(sender.tabId, sender.url, card);
    return { ok: true, card };
  },
};
