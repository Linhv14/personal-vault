import { render, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { logoSvg } from "../../src/ui/logo.js";
import { Toast } from "../ui/components/Toast.js";
import { localeSignal, useT } from "../ui/i18n.js";
import { Navigation, pageFromHash, type Page } from "./Navigation.js";
import { Account } from "./pages/Account.js";
import { Data } from "./pages/Data.js";
import { General } from "./pages/General.js";
import { Health } from "./pages/Health.js";
import { Security } from "./pages/Security.js";
import { Teams } from "./pages/Teams.js";
import { isSignedIn, localState, toastMessage, watchStorage } from "./state.js";

const PAGE_VIEWS: Record<Page, ComponentType> = {
  general: General,
  security: Security,
  teams: Teams,
  health: Health,
  data: Data,
  account: Account,
};

function SettingsApp() {
  const t = useT();
  const locale = localeSignal.value;
  const [page, setPage] = useState<Page>(pageFromHash());

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => watchStorage(), []);

  useEffect(() => {
    document.title = `${t("settings.title")} · 1PW`;
    document.documentElement.lang = locale;
  }, [locale, t]);

  const PageView = PAGE_VIEWS[page];
  return (
    <>
      <div className="layout">
        <aside className="sidebar">
          <header className="brand">
            <span
              className="brand-logo"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: logoSvg("settings-logo") }}
            />
            <span className="wordmark">
              <span className="wordmark-accent">1</span>PW
            </span>
          </header>
          <Navigation page={page} />
        </aside>
        <main>
          {!isSignedIn(localState.value) && <p className="notice">{t("settings.signed_out")}</p>}
          <PageView />
        </main>
      </div>
      <Toast message={toastMessage.value} />
    </>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<SettingsApp />, root);
