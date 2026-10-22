import { render } from "preact";
import { useEffect } from "preact/hooks";
import {
  ConsoleHost,
  Icon,
  localeSignal,
  relayLinkOutcome,
  setHumanCheck,
  setUiLocale,
  useT,
  vaultKeySignal,
} from "#ext/web-host.js";
import { turnstileToken } from "#ui/turnstile.js";
import { SignIn } from "./SignIn.js";
import { accountEmail, signOut, startWebSession } from "./session.js";

function App() {
  const t = useT();
  const locale = localeSignal.value;
  useEffect(() => {
    document.title = `${t("web.title")} · 7key`;
    document.documentElement.lang = locale;
  }, [locale, t]);

  const vaultKey = vaultKeySignal.value;
  if (!vaultKey) {
    return <SignIn />;
  }
  return (
    <ConsoleHost
      vaultKey={vaultKey}
      account={accountEmail.value ?? ""}
      footer={
        <button type="button" className="side-link" onClick={() => void signOut()}>
          <Icon name="lock" />
          {t("web.sign_out")}
        </button>
      }
    />
  );
}

function LinkReturned() {
  const t = useT();
  return (
    <main className="sign-in">
      <p className="panel sign-in-card">{t("sso_link.close_window")}</p>
    </main>
  );
}

startWebSession();
setHumanCheck((_apiUrl, siteKey) => turnstileToken(siteKey));
setUiLocale(undefined);
const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}
render(relayLinkOutcome() ? <LinkReturned /> : <App />, root);
