import type { IconName } from "../../src/ui/icons.js";
import { lock } from "../lib/storage.js";
import { Icon } from "../ui/components/Icon.js";
import { useT } from "../ui/i18n.js";
import { refreshSession, vaultKeyRawSignal } from "../ui/store/session.js";
import { isSignedIn, localState, showToast } from "./state.js";

export const PAGES = ["general", "security", "health", "data", "account"] as const;
export type Page = (typeof PAGES)[number];

export function pageFromHash(): Page {
  const hash = location.hash.slice(1);
  return PAGES.find((page) => page === hash) ?? "general";
}

export function Navigation({ page }: { page: Page }) {
  const t = useT();
  const entries: { page: Page; label: string; icon: IconName }[] = [
    { page: "general", label: t("settings.section_preferences"), icon: "gear" },
    { page: "security", label: t("settings.section_security"), icon: "shield" },
    { page: "health", label: t("health.title"), icon: "pulse" },
    { page: "data", label: t("settings.section_data"), icon: "database" },
    { page: "account", label: t("settings.section_account"), icon: "person" },
  ];
  const lockNow = async () => {
    await lock();
    await refreshSession();
    showToast(t("settings.locked_hint"));
  };

  return (
    <nav className="nav" aria-label={t("settings.title")}>
      {entries.map(({ page: entry, label, icon }) => (
        <a href={`#${entry}`} aria-current={page === entry ? "page" : undefined} key={entry}>
          <Icon name={icon} />
          <span>{label}</span>
        </a>
      ))}
      {vaultKeyRawSignal.value && (
        <button type="button" className="nav-action" onClick={() => void lockNow()}>
          <Icon name="lock" />
          <span>{t("list.lock_now")}</span>
        </button>
      )}
      {!isSignedIn(localState.value) && (
        <span className="row-hint nav-note">{t("settings.signed_out")}</span>
      )}
    </nav>
  );
}
