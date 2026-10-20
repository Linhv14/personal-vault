import { render } from "preact";
import { useEffect } from "preact/hooks";
import { ConsoleHost } from "../extension/console/ConsoleHost.js";
import { setHumanCheck } from "../extension/lib/api.js";
import { Icon } from "../extension/ui/components/Icon.js";
import { localeSignal, setUiLocale, useT } from "../extension/ui/i18n.js";
import { vaultKeySignal } from "../extension/ui/store/session.js";
import { turnstileToken } from "../src/ui/turnstile.js";
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
  if (!vaultKey) return <SignIn />;
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

startWebSession();
setHumanCheck((_apiUrl, siteKey) => turnstileToken(siteKey));
setUiLocale(undefined);
const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<App />, root);
