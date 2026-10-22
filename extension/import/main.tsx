import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getLocal } from "../lib/storage.js";
import { Logo, Wordmark } from "../ui/components/Logo.js";
import { localeSignal, setUiLocale, useT } from "../ui/i18n.js";
import { ExportPanel } from "./ExportPanel.js";
import { ImportPanel } from "./ImportPanel.js";

type Tab = "import" | "export";

function tabFromHash(): Tab {
  return location.hash === "#export" ? "export" : "import";
}

function TransferApp() {
  const t = useT();
  const [tab, setTab] = useState<Tab>(tabFromHash());
  const [session, setSession] = useState(0);

  useEffect(() => {
    const onChanged = (_changes: object, area: string) => {
      if (area === "session") {
        setSession((value) => value + 1);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${t("transfer.title")} · 7KEY`;
    document.documentElement.lang = localeSignal.value;
  }, [t]);

  return (
    <main>
      <header className="brand">
        <Logo size={22} bare />
        <Wordmark />
      </header>
      <h1>{t("transfer.title")}</h1>
      <nav className="tabs" role="tablist" aria-label={t("transfer.title")}>
        {(["import", "export"] as const).map((value) => (
          <a
            key={value}
            href={`#${value}`}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "tab active" : "tab"}
          >
            {t(value === "import" ? "transfer.import" : "transfer.export")}
          </a>
        ))}
      </nav>
      <p className="lead">{t(tab === "import" ? "import.lead" : "export.lead")}</p>
      {tab === "import" ? <ImportPanel key={session} /> : <ExportPanel key={session} />}
    </main>
  );
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}
setUiLocale((await getLocal()).locale);
render(<TransferApp />, root);
