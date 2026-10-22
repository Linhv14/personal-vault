import type { IconName } from "#ui/icons.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { Wordmark, Logo } from "#ext/ui/components/Logo.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { inVault, live, tagsOf } from "../filters.js";
import {
  openConsole,
  currentVault,
  drawerOpen,
  items,
  lockNow,
  openGenerator,
  openImport,
  openSettings,
  scope,
  typeFilter,
  type Scope,
} from "../state.js";
import { orgSnapshot } from "../promos.js";
import { useDismiss } from "./Menu.js";

function DrawerLink({
  icon,
  label,
  count,
  highlight = false,
  active = false,
  onSelect,
}: {
  icon: IconName;
  label: string;
  count?: number;
  highlight?: boolean;
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "drawer-link active" : "drawer-link"}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <Icon name={icon} />
      <span className="drawer-label">{label}</span>
      {count !== undefined && (
        <span className={highlight ? "drawer-count highlight" : "drawer-count"}>{count}</span>
      )}
    </button>
  );
}

function ScopeLinks({ onPick }: { onPick: () => void }) {
  const t = useT();
  const all = inVault(currentVault.value, items.value);
  const current = live(all);
  const link = (value: Scope, icon: IconName, label: string, count: number) => (
    <DrawerLink
      key={value}
      icon={icon}
      label={label}
      count={count}
      active={scope.value === value}
      onSelect={() => {
        scope.value = value;
        typeFilter.value = "all";
        onPick();
      }}
    />
  );
  return (
    <div className="drawer-section drawer-scopes">
      {link("all", "database", t("list.all_items"), current.length)}
      {link(
        "favorites",
        "star",
        t("list.favorites"),
        current.filter((item) => item.favorite).length,
      )}
      {tagsOf(all, localeSignal.value).map((tag) =>
        link(`tag:${tag}`, "tag", tag, current.filter((item) => item.tags?.includes(tag)).length),
      )}
      {link("trash", "trash", t("list.trash"), all.length - current.length)}
    </div>
  );
}

export function Drawer() {
  const t = useT();
  const close = () => (drawerOpen.value = false);
  const ref = useDismiss(close);

  return (
    <div
      className="drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <nav className="drawer" ref={ref} aria-label={t("list.menu")}>
        <div className="drawer-brand">
          <Logo size={20} bare />
          <Wordmark />
        </div>
        <ScopeLinks onPick={close} />
        <div className="drawer-section drawer-actions">
          <DrawerLink
            icon="users"
            label={t("orgs.title")}
            count={orgSnapshot.value?.invites.length || orgSnapshot.value?.orgs || undefined}
            highlight={(orgSnapshot.value?.invites.length ?? 0) > 0}
            onSelect={() => {
              close();
              openConsole();
            }}
          />
          <DrawerLink icon="wand" label={t("list.generator")} onSelect={openGenerator} />
          <DrawerLink
            icon="upload"
            label={t("list.transfer")}
            onSelect={() => {
              close();
              openImport();
            }}
          />
          <DrawerLink
            icon="gear"
            label={t("list.settings")}
            onSelect={() => {
              close();
              openSettings();
            }}
          />
          <DrawerLink icon="lock" label={t("list.lock_now")} onSelect={() => void lockNow()} />
        </div>
      </nav>
    </div>
  );
}
