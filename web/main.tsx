import { render } from "preact";
import { useEffect } from "preact/hooks";
import { logoSvg } from "../src/ui/logo.js";
import { OrganizationPage } from "../extension/settings/organization/OrganizationPage.js";
import { toastMessage } from "../extension/settings/state.js";
import { Icon } from "../extension/ui/components/Icon.js";
import { Toast } from "../extension/ui/components/Toast.js";
import { localeSignal, setUiLocale, useT } from "../extension/ui/i18n.js";
import { vaultKeySignal } from "../extension/ui/store/session.js";
import { SignIn } from "./SignIn.js";
import { accountEmail, signOut, startWebSession } from "./session.js";

function Dashboard() {
  const t = useT();
  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="brand">
          <span
            className="brand-logo"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: logoSvg("web-logo") }}
          />
          <span className="wordmark">
            <span className="wordmark-accent">1</span>PW
          </span>
        </header>
        <nav className="nav" aria-label={t("web.title")}>
          <a href="#teams" aria-current="page">
            <Icon name="users" />
            <span>{t("orgs.title")}</span>
          </a>
          <button type="button" className="nav-action" onClick={() => void signOut()}>
            <Icon name="lock" />
            <span>{t("web.sign_out")}</span>
          </button>
          <span className="row-hint nav-note">{accountEmail.value}</span>
        </nav>
      </aside>
      <main>
        <OrganizationPage />
      </main>
    </div>
  );
}

function App() {
  const t = useT();
  const locale = localeSignal.value;
  useEffect(() => {
    document.title = `${t("web.title")} · 1PW`;
    document.documentElement.lang = locale;
  }, [locale, t]);

  return (
    <>
      {vaultKeySignal.value ? <Dashboard /> : <SignIn />}
      <Toast message={toastMessage.value} />
    </>
  );
}

startWebSession();
setUiLocale(undefined);
const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<App />, root);
