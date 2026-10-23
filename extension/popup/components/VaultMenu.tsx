import type { ComponentChildren } from "preact";
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import type { IconName } from "#ui/icons.js";
import type { VaultDef } from "#ext/lib/vault/types.js";
import { consolePathOf } from "#ext/lib/vault/shared.js";
import { DEFAULT_VAULT_ID, vaultOf } from "#ext/lib/vault/defs.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { useT } from "#ext/ui/i18n.js";
import {
  currentVault,
  deleteVault,
  items,
  moveVaultItems,
  openConsole,
  openVaultEditor,
  switchVault,
  vaultBusy,
  vaults,
} from "../state.js";
import { VaultBadge } from "#ext/ui/components/ItemIcons.js";
import { useDismiss } from "./Menu.js";

type View =
  | { kind: "list" }
  | { kind: "actions"; vault: VaultDef }
  | { kind: "move"; vault: VaultDef }
  | { kind: "share"; vault: VaultDef };

function MenuButton({
  icon,
  leading,
  label,
  trailing,
  checked,
  danger = false,
  disabled = false,
  onSelect,
}: {
  icon?: IconName;
  leading?: ComponentChildren;
  label: string;
  trailing?: number;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={danger ? "menu-item danger" : "menu-item"}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {leading ?? (icon && <Icon name={icon} />)}
      <span className="menu-label">{label}</span>
      {trailing !== undefined && <span className="menu-trailing">{trailing}</span>}
      {checked && <Icon name="check" className="menu-check" />}
    </button>
  );
}

function VaultPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useDismiss(onClose);
  const [view, setView] = useState<View>({ kind: "list" });
  const list = vaults.value;
  const own = list.filter((vault) => !vault.shared);
  const shared = list.filter((vault) => vault.shared);
  const byOrg = [...new Set(shared.map((vault) => vault.shared?.orgName ?? ""))].map((org) => ({
    org,
    vaults: shared.filter((vault) => vault.shared?.orgName === org),
  }));
  const live = items.value.filter((item) => !item.trashedAt);
  const count = (id: string) => live.filter((item) => vaultOf(item) === id).length;
  const busy = vaultBusy.value;

  const row = (vault: VaultDef) => (
    <div className="vault-row" key={vault.id}>
      <MenuButton
        leading={<VaultBadge vault={vault} />}
        label={vault.name}
        trailing={count(vault.id)}
        checked={currentVault.value === vault.id}
        onSelect={() => {
          switchVault(vault.id);
          onClose();
        }}
      />
      <IconButton
        icon="more"
        className="vault-more"
        label={t("item.more")}
        onClick={() => setView({ kind: "actions", vault })}
      />
    </div>
  );

  const header = (vault: VaultDef, title: string) => (
    <div className="menu-header">
      <IconButton icon="back" label={t("common.back")} onClick={() => setView({ kind: "list" })} />
      <VaultBadge vault={vault} />
      <span className="menu-label">{title}</span>
    </div>
  );

  return (
    <div className="menu menu-left vault-menu" role="menu" ref={ref}>
      {view.kind === "list" && (
        <>
          <MenuButton
            icon="database"
            label={t("vault.all")}
            trailing={live.length}
            checked={currentVault.value === "all"}
            onSelect={() => {
              switchVault("all");
              onClose();
            }}
          />
          {own.map(row)}
          {byOrg.map((group) => (
            <Fragment key={group.org}>
              <div className="menu-divider" />
              <div className="menu-section">{group.org}</div>
              {group.vaults.map(row)}
            </Fragment>
          ))}
          <div className="menu-divider" />
          <MenuButton
            icon="plus"
            label={t("vault.new")}
            onSelect={() => {
              onClose();
              openVaultEditor(null);
            }}
          />
        </>
      )}
      {view.kind === "actions" && view.vault.shared && (
        <>
          {header(view.vault, view.vault.name)}
          <p className="menu-note">
            {t("vault.team_vault_hint", {
              team: view.vault.name,
              org: view.vault.shared.orgName,
            })}
          </p>
          {count(view.vault.id) > 0 && (
            <MenuButton
              icon="move"
              label={t("vault.move_all")}
              disabled={busy}
              onSelect={() => setView({ kind: "move", vault: view.vault })}
            />
          )}
          <MenuButton
            icon="users"
            label={t("vault.manage_team")}
            onSelect={() => {
              onClose();
              openConsole(consolePathOf(view.vault.id));
            }}
          />
        </>
      )}
      {view.kind === "actions" && !view.vault.shared && (
        <>
          {header(view.vault, view.vault.name)}
          <MenuButton
            icon="pencil"
            label={t("vault.edit")}
            onSelect={() => {
              onClose();
              openVaultEditor(view.vault);
            }}
          />
          {count(view.vault.id) > 0 && (
            <MenuButton
              icon="users"
              label={t("vault.share_team")}
              disabled={busy}
              onSelect={() => {
                if (shared.length > 0) {
                  setView({ kind: "share", vault: view.vault });
                  return;
                }
                onClose();
                openConsole();
              }}
            />
          )}
          {count(view.vault.id) > 0 && (
            <MenuButton
              icon="move"
              label={t("vault.move_all")}
              disabled={busy}
              onSelect={() => setView({ kind: "move", vault: view.vault })}
            />
          )}
          {view.vault.id !== DEFAULT_VAULT_ID && (
            <MenuButton
              icon="trash"
              label={t("vault.delete")}
              danger
              disabled={busy}
              onSelect={() => {
                onClose();
                void deleteVault(view.vault);
              }}
            />
          )}
        </>
      )}
      {view.kind === "move" && (
        <>
          {header(view.vault, t("vault.move_all"))}
          {list
            .filter((vault) => vault.id !== view.vault.id)
            .map((vault) => (
              <MenuButton
                key={vault.id}
                leading={<VaultBadge vault={vault} />}
                label={vault.name}
                trailing={count(vault.id)}
                onSelect={() => {
                  onClose();
                  void moveVaultItems(view.vault, vault);
                }}
              />
            ))}
          {list.length > 1 && <div className="menu-divider" />}
          <MenuButton
            icon="plus"
            label={t("vault.new_named")}
            onSelect={() => {
              onClose();
              openVaultEditor(null, view.vault);
            }}
          />
        </>
      )}
      {view.kind === "share" && (
        <>
          {header(view.vault, t("vault.share_team"))}
          <p className="menu-note">{t("vault.share_team_hint")}</p>
          {byOrg.map((group) => (
            <Fragment key={group.org}>
              <div className="menu-section">{group.org}</div>
              {group.vaults.map((vault) => (
                <MenuButton
                  key={vault.id}
                  leading={<VaultBadge vault={vault} />}
                  label={vault.name}
                  trailing={count(vault.id)}
                  onSelect={() => {
                    onClose();
                    void moveVaultItems(view.vault, vault);
                  }}
                />
              ))}
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}

export function VaultMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = vaults.value.find((vault) => vault.id === currentVault.value);

  return (
    <div className="vault-switch">
      <button
        type="button"
        className="vault-pill"
        id="vault-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {selected ? <VaultBadge vault={selected} /> : <Icon name="database" />}
        <span>{selected?.name ?? t("vault.all")}</span>
        <Icon name="chevron" className="vault-chevron" />
      </button>
      {open && <VaultPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
