import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { itemType, type ItemType } from "../../lib/item-types.js";
import { TYPE_ICON } from "../../ui/item-icons.js";
import type { IconName } from "../../../src/ui/icons.js";
import type { VaultDef, VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { knownLogo, logoDomainOf, logoFor, showLogos } from "../logos.js";

export function Avatar({ title }: { title: string }) {
  return <span className="avatar">{[...title.trim()][0]?.toUpperCase() ?? "?"}</span>;
}

export function TypeBadge({ type }: { type: ItemType }) {
  return (
    <span className={`avatar type-badge type-${type}`}>
      <Icon name={TYPE_ICON[type]} />
    </span>
  );
}

function SiteLogo({ domain, fallback }: { domain: string; fallback: ComponentChildren }) {
  const [src, setSrc] = useState(() => knownLogo(domain) ?? null);
  useEffect(() => {
    let current = true;
    setSrc(knownLogo(domain) ?? null);
    void logoFor(domain).then((url) => {
      if (current) {
        setSrc(url);
      }
    });
    return () => {
      current = false;
    };
  }, [domain]);
  if (!src) {
    return <>{fallback}</>;
  }
  return (
    <span className="avatar site-logo">
      <img src={src} alt="" />
    </span>
  );
}

export function ItemIcon({ item }: { item: VaultItem }) {
  const type = itemType(item);
  const fallback = type === "login" ? <Avatar title={item.title} /> : <TypeBadge type={type} />;
  const domain =
    (type === "login" || type === "api") && showLogos.value ? logoDomainOf(item.url) : null;
  return domain ? <SiteLogo domain={domain} fallback={fallback} key={domain} /> : fallback;
}

export function VaultBadge({ vault }: { vault: VaultDef }) {
  return (
    <span className="vault-badge" data-color={vault.color}>
      <Icon name={vault.icon as IconName} />
    </span>
  );
}
