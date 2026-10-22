import { useState } from "preact/hooks";
import { ITEM_TYPES, KIND_LABEL } from "#ext/lib/item-types.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { useT } from "#ext/ui/i18n.js";
import { MenuList } from "./Menu.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { TypeBadge } from "./ItemIcons.js";
import { VaultMenu } from "./VaultMenu.js";
import { orgSnapshot } from "../promos.js";
import { openConsole, drawerOpen, openEditor, searchQuery } from "../state.js";

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

function TeamsButton() {
  const t = useT();
  const snapshot = orgSnapshot.value;
  return (
    <button
      type="button"
      id="btn-teams"
      className={snapshot ? "teams-cta" : "teams-cta pending"}
      title={t("orgs.cta_hint")}
      aria-hidden={snapshot ? undefined : "true"}
      tabIndex={snapshot ? undefined : -1}
      onClick={() => openConsole()}
    >
      <Icon name="users" />
      <span>{t(snapshot && snapshot.orgs > 0 ? "orgs.cta_open" : "orgs.cta_start")}</span>
      {snapshot && snapshot.invites.length > 0 && (
        <span className="teams-cta-dot" aria-label={t("orgs.invitations")} />
      )}
    </button>
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
          onInput={(event) => (searchQuery.value = event.currentTarget.value)}
        />
      </label>
      <TeamsButton />
      <AddButton />
    </header>
  );
}
