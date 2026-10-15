import { generateTotp, type TotpConfig } from "../../../src/core/totp.js";
import type { MessageKey, Translate } from "../../../src/i18n/index.js";
import type { IconName } from "../../../src/ui/icons.js";
import { cardDigits, itemType, lastFour, unusedCodes } from "../../lib/item-types.js";
import { registrableDomain, type VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { copy, nowMs, selectItem, selectedId } from "../state.js";
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

function QuickCopy({
  icon,
  label,
  what,
  value,
}: {
  icon: IconName;
  label: MessageKey;
  what: MessageKey;
  value: string;
}) {
  const t = useT();
  return (
    <IconButton
      icon={icon}
      label={t(label)}
      className="quick"
      onClick={() => void copy(value, t(what).toLowerCase())}
    />
  );
}

function QuickTotp({ config }: { config: TotpConfig }) {
  const t = useT();
  return (
    <IconButton
      icon="clock"
      label={t("item.copy_totp")}
      className="quick"
      onClick={() =>
        void generateTotp(config, nowMs()).then((code) => copy(code, t("common.totp")))
      }
    />
  );
}

function QuickActions({ item }: { item: VaultItem }) {
  if (item.trashedAt) return null;
  const password = item.password && (
    <QuickCopy icon="key" label="item.copy_password" what="common.password" value={item.password} />
  );
  switch (itemType(item)) {
    case "login":
      return (
        <>
          {item.totp && <QuickTotp config={item.totp} />}
          {password}
        </>
      );
    case "wifi":
      return password || null;
    case "card":
      return item.cardNumber ? (
        <QuickCopy
          icon="card"
          label="item.copy_card_number"
          what="field.card_number"
          value={cardDigits(item.cardNumber)}
        />
      ) : null;
    case "api":
      return item.password ? (
        <QuickCopy
          icon="key"
          label="item.copy_secret"
          what="field.api_secret"
          value={item.password}
        />
      ) : null;
    case "ssh":
      return item.sshPublicKey ? (
        <QuickCopy
          icon="copy"
          label="item.copy_public_key"
          what="field.public_key"
          value={item.sshPublicKey}
        />
      ) : null;
    case "bank":
      return item.accountNumber ? (
        <QuickCopy
          icon="copy"
          label="item.copy_account_number"
          what="field.account_number"
          value={item.accountNumber}
        />
      ) : null;
    case "license":
      return item.licenseKey ? (
        <QuickCopy
          icon="key"
          label="item.copy_license_key"
          what="field.license_key"
          value={item.licenseKey}
        />
      ) : null;
    default:
      return null;
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
      <div className="row-actions">
        <QuickActions item={item} />
      </div>
    </div>
  );
}
