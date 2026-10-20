import { itemSubtitle } from "../../lib/item-subtitle.js";
import type { VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { selectItem, selectedId } from "../state.js";
import { ItemIcon } from "./ItemIcons.js";

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
