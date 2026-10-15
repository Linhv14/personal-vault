import { useState } from "preact/hooks";
import { ITEM_TYPES, KIND_LABEL } from "../../lib/item-types.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { MenuList } from "./Menu.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { TypeBadge } from "./ItemIcons.js";
import { VaultMenu } from "./VaultMenu.js";
import { drawerOpen, openEditor, searchQuery } from "../state.js";

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
      <VaultMenu />
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
