import { render } from "preact";
import { useEffect } from "preact/hooks";
import { lock } from "../lib/storage.js";
import { Account } from "../settings/pages/Account.js";
import { Data } from "../settings/pages/Data.js";
import { General } from "../settings/pages/General.js";
import { Health } from "../settings/pages/Health.js";
import { Security } from "../settings/pages/Security.js";
import { localState, showToast, watchStorage } from "../settings/state.js";
import { Icon } from "../ui/components/Icon.js";
import { useT } from "../ui/i18n.js";
import { refreshSession, vaultKeySignal } from "../ui/store/session.js";
import type { PersonalPage } from "./ConsoleApp.js";
import { ConsoleHost } from "./ConsoleHost.js";

const PERSONAL: PersonalPage[] = [
  { section: "general", icon: "gear", label: "settings.section_preferences", view: General },
  { section: "security", icon: "shield", label: "settings.section_security", view: Security },
  { section: "health", icon: "pulse", label: "health.title", view: Health },
  { section: "data", icon: "database", label: "settings.section_data", view: Data },
  { section: "account", icon: "person", label: "settings.section_account", view: Account },
];

function Locked() {
  const t = useT();
  return (
    <div className="console loading">
      <div className="locked">
        <Icon name="lock" />
        <strong>{t("console.locked_title")}</strong>
        <p className="muted">{t("console.locked_text")}</p>
      </div>
    </div>
  );
}

function ExtensionConsole() {
  const t = useT();
  useEffect(() => watchStorage(), []);
  useEffect(() => {
    document.title = `${t("settings.title")} · 1PW`;
  }, [t]);

  const lockNow = async () => {
    await lock();
    await refreshSession();
    showToast(t("settings.locked_hint"));
  };

  const vaultKey = vaultKeySignal.value;
  if (!vaultKey) return <Locked />;
  return (
    <ConsoleHost
      vaultKey={vaultKey}
      account={localState.value.email ?? ""}
      personal={PERSONAL}
      footer={
        <button type="button" className="side-link" onClick={() => void lockNow()}>
          <Icon name="lock" />
          {t("list.lock_now")}
        </button>
      }
    />
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<ExtensionConsole />, root);
