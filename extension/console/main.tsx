import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { resumeUnlock } from "../lib/resume.js";
import { getLocal } from "../lib/storage.js";
import { Icon } from "../ui/components/Icon.js";
import { setUiLocale, useT } from "../ui/i18n.js";
import { refreshSession, vaultKeySignal } from "../ui/store/session.js";
import { ConsoleHost } from "./ConsoleHost.js";

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
  const [email, setEmail] = useState("");

  useEffect(() => {
    void getLocal().then((local) => {
      setUiLocale(local.locale);
      setEmail(local.email ?? "");
    });
    void resumeUnlock().then(() => refreshSession());
    const onChanged = (_: unknown, area: string) => {
      if (area === "session") void refreshSession();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    document.title = `${t("web.title")} · 1PW`;
  }, [t]);

  const vaultKey = vaultKeySignal.value;
  return vaultKey ? <ConsoleHost vaultKey={vaultKey} account={email} /> : <Locked />;
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<ExtensionConsole />, root);
