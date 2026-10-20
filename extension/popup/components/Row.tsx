import { itemSubtitle } from "../../lib/item-subtitle.js";
import type { VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { daysUntilPurge } from "../../lib/trash.js";
import { nowMs, selectItem, selectedId } from "../state.js";
import { ItemIcon } from "./ItemIcons.js";

export function Row({ item }: { item: VaultItem }) {
  const t = useT();
  const selected = selectedId.value === item.id;
  const purgeDays = daysUntilPurge(item, Math.floor(nowMs() / 1000));
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
      {purgeDays !== null && (
        <span
          className={purgeDays <= 3 ? "purge-badge soon" : "purge-badge"}
          title={t("trash.purges_in", { days: purgeDays })}
        >
          {t("trash.days_left", { days: purgeDays })}
        </span>
      )}
    </div>
  );
}
