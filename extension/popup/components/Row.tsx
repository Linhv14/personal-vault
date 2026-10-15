import type { Translate } from "../../../src/i18n/index.js";
import { itemType, lastFour, unusedCodes } from "../../lib/item-types.js";
import { registrableDomain, type VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { selectItem, selectedId } from "../state.js";
import { ItemIcon } from "./ItemIcons.js";

function hostLabel(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return null;
  }
}

function keyComment(publicKey: string | undefined): string {
  return publicKey?.trim().split(/\s+/).slice(2).join(" ") ?? "";
}

function itemSubtitle(item: VaultItem, t: Translate): string {
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
      return item.username || (item.url ? (hostLabel(item.url) ?? item.url) : "");
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

export function Row({ item }: { item: VaultItem }) {
  const t = useT();
  const selected = selectedId.value === item.id;
  return (
    <div
      className={selected ? "row selected" : "row"}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-id={item.id}
      onClick={() => selectItem(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") selectItem(item.id);
      }}
    >
      <ItemIcon item={item} />
      <div className="row-text">
        <div className="row-title">
          <span className="row-title-text">{item.title}</span>
          {item.favorite && (
            <span className="favorite-mark" role="img" aria-label={t("list.favorites")}>
              <Icon name="star" />
            </span>
          )}
        </div>
        <div className="row-sub">{itemSubtitle(item, t)}</div>
      </div>
    </div>
  );
}
