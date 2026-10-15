import type { IconName } from "../../../src/ui/icons.js";
import { Icon } from "../../ui/components/Icon.js";
import { Logo } from "../../ui/components/Logo.js";
import { useT } from "../../ui/i18n.js";
import { useDismiss } from "./Menu.js";
import { drawerOpen, lockNow, openGenerator, openImport, openSettings } from "../state.js";

function DrawerLink({
  icon,
  label,
  count,
  active = false,
  onSelect,
}: {
  icon: IconName;
  label: string;
  count?: number;
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
      {count !== undefined && <span className="drawer-count">{count}</span>}
    </button>
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
        if (event.target === event.currentTarget) close();
      }}
    >
      <nav className="drawer" ref={ref} aria-label={t("list.menu")}>
        <div className="drawer-brand">
          <Logo size={24} />
          <span className="wordmark">
            <span className="wordmark-accent">1</span>PW
          </span>
        </div>
        <div className="drawer-section">
          <DrawerLink icon="wand" label={t("list.generator")} onSelect={openGenerator} />
          <DrawerLink
            icon="upload"
            label={t("list.import")}
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
