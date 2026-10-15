import { useState } from "preact/hooks";
import type { IconName } from "../../../src/ui/icons.js";
import { ITEM_TYPES, KIND_LABEL } from "../../lib/item-types.js";
import { Icon } from "../../ui/components/Icon.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { live, tagsOf } from "../filters.js";
import { MenuList } from "./Menu.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { TypeBadge } from "./ItemIcons.js";
import {
  drawerOpen,
  items,
  openEditor,
  scope,
  searchQuery,
  typeFilter,
  type Scope,
} from "../state.js";

function useScopeLabel(): string {
  const t = useT();
  const current = scope.value;
  if (current === "favorites") return t("list.favorites");
  if (current === "trash") return t("list.trash");
  if (current.startsWith("tag:")) return current.slice(4);
  return t("list.all_items");
}
function scopeIcon(value: Scope): IconName {
  if (value === "trash") return "trash";
  if (value === "favorites") return "star";
  return value.startsWith("tag:") ? "tag" : "database";
}

function ScopeMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = useScopeLabel();
  const all = items.value;
  const current = live(all);
  const pick = (next: Scope) => {
    scope.value = next;
    typeFilter.value = "all";
  };
  const entry = (value: Scope, text: string, count: number) => ({
    key: value,
    label: text,
    icon: scopeIcon(value),
    trailing: count,
    checked: scope.value === value,
    onSelect: () => pick(value),
  });

  return (
    <div className="scope">
      <button
        type="button"
        className="scope-pill"
        id="scope-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        <Icon name={scopeIcon(scope.value)} />
        <span>{label}</span>
        <Icon name="chevron" className="scope-chevron" />
      </button>
      {open && (
        <MenuList
          onClose={() => setOpen(false)}
          entries={[
            entry("all", t("list.all_items"), current.length),
            entry("favorites", t("list.favorites"), current.filter((item) => item.favorite).length),
            ...tagsOf(all, localeSignal.value).map((tag) =>
              entry(`tag:${tag}`, tag, current.filter((item) => item.tags?.includes(tag)).length),
            ),
            entry("trash", t("list.trash"), all.length - current.length),
          ]}
        />
      )}
    </div>
  );
}

function AddButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="add">
      <IconButton
        id="btn-add"
        icon="plus"
        className="accent round"
        label={t("list.add")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <MenuList
          id="add-menu"
          align="right"
          className="add-menu"
          onClose={() => setOpen(false)}
          entries={ITEM_TYPES.map((type) => ({
            key: type,
            label: t(KIND_LABEL[type]),
            leading: <TypeBadge type={type} />,
            onSelect: () => openEditor(null, type),
          }))}
        />
      )}
    </div>
  );
}

export function Topbar() {
  const t = useT();
  return (
    <header className="topbar">
      <IconButton
        id="btn-menu"
        icon="menu"
        label={t("list.menu")}
        aria-expanded={drawerOpen.value}
        onClick={() => (drawerOpen.value = !drawerOpen.value)}
      />
      <ScopeMenu />
      <label className="search">
        <Icon name="search" />
        <input
          id="search"
          type="search"
          autoComplete="off"
          placeholder={t("list.search")}
          value={searchQuery.value}
          onInput={(event) => (searchQuery.value = (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <AddButton />
    </header>
  );
}
