import type { Translate } from "#i18n/index.js";
import { itemType, lastFour, unusedCodes } from "./item-types.js";
import { parseSiteUrl, registrableDomain } from "#core/site.js";
import type { VaultItem } from "./vault/types.js";

function keyComment(publicKey: string | undefined): string {
  return publicKey?.trim().split(/\s+/).slice(2).join(" ") ?? "";
}

export function itemSubtitle(item: VaultItem, t: Translate): string {
  switch (itemType(item)) {
    case "login":
      return item.username || (item.url ? (registrableDomain(item.url) ?? item.url) : "");
    case "card": {
      const digits = lastFour(item.cardNumber);
      return [item.cardholder, digits && t("item.card_ending", { digits })]
        .filter(Boolean)
        .join(" · ");
    }
    case "identity":
      return [item.fullName, item.city].filter(Boolean).join(" · ");
    case "recovery": {
      const total = item.codes?.length ?? 0;
      const left = unusedCodes(item).length;
      return left === total
        ? t("item.codes_count", { count: total })
        : t("item.codes_left", { left, total });
    }
    case "wifi":
      return item.ssid ?? "";
    case "note":
      return (item.note ?? "").split("\n")[0] ?? "";
    case "api":
      return item.username || (item.url ? (parseSiteUrl(item.url)?.host ?? item.url) : "");
    case "ssh":
      return item.sshFingerprint ?? keyComment(item.sshPublicKey);
    case "bank": {
      const digits = (item.accountNumber ?? "").replace(/\s/g, "").slice(-4);
      return [item.bankName, digits && `•••• ${digits}`].filter(Boolean).join(" · ");
    }
    case "document":
      return [item.documentKind, item.fullName].filter(Boolean).join(" · ");
    case "license":
      return [item.version, item.fullName].filter(Boolean).join(" · ");
  }
}
