import { useState } from "preact/hooks";
import { normalizeRecoveryCode } from "../../../src/core/recovery.js";
import { describeError } from "../../../src/i18n/index.js";
import { recoverAccount } from "../../lib/account-recovery.js";
import { getLocal, setLocal } from "../../lib/storage.js";
import { Icon } from "../../ui/components/Icon.js";
import { RecoveryCodeView } from "../../ui/components/RecoveryCodeView.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { signIn } from "../auth.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { toast } from "../state.js";

export interface RecoverProps {
  email: string;
  server: string;
  onCancel: () => void;
}

export function Recover({ email: initialEmail, server, onCancel }: RecoverProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<{ email: string; password: string; code: string } | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(data.get("email")).trim().toLowerCase();
    const code = String(data.get("code"));
    const password = String(data.get("password"));
    if (!normalizeRecoveryCode(code)) {
      setError(t("recovery.invalid"));
      return;
    }
    if (password !== String(data.get("confirm"))) {
      setError(t("setup.password_mismatch"));
      return;
    }
    setWorking(true);
    const previous = await getLocal();
    try {
      await setLocal({ apiUrl: server, email });
      const next = await recoverAccount(email, code, password, localeSignal.value);
      setDone({ email, password, code: next });
    } catch (failure) {
      if (!previous.wrappedVaultKey) await chrome.storage.local.remove("email");
      else await setLocal({ apiUrl: previous.apiUrl, email: previous.email });
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const openVault = async () => {
    if (!done) return;
    setWorking(true);
    try {
      await signIn(done.email, done.password);
    } catch (failure) {
      setError(describeError(failure, t));
      setWorking(false);
    }
  };

  return (
    <AuthLayout id="screen-recover">
      <header className="title-bar">
        <button
          type="button"
          className="icon-button"
          title={t("common.back")}
          aria-label={t("common.back")}
          hidden={done !== null}
          onClick={onCancel}
        >
          <Icon name="back" />
        </button>
        <h1>{t(done ? "recovery.new_title" : "recovery.reset_title")}</h1>
      </header>
      {done ? (
        <>
          <p className="hint">{t("recovery.new_hint")}</p>
          <RecoveryCodeView
            code={done.code}
            email={done.email}
            server={server}
            createdAt={Math.floor(Date.now() / 1000)}
            doneLabel={t(working ? "unlock.working" : "recovery.continue")}
            onCopied={() => toast(t("recovery.copied"))}
            onDone={() => void openVault()}
          />
        </>
      ) : (
        <form id="form-recover" className="stack" onSubmit={(event) => void submit(event)}>
          <p className="hint">{t("recovery.reset_hint")}</p>
          <label>
            <span>{t("setup.email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={initialEmail}
              required
            />
          </label>
          <label>
            <span>{t("recovery.code")}</span>
            <input
              name="code"
              autoComplete="off"
              spellcheck={false}
              placeholder="XXXX-XXXX-XXXX-…"
              required
              autoFocus
            />
          </label>
          <label>
            <span>{t("settings.new_password")}</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label>
            <span>{t("setup.confirm")}</span>
            <input name="confirm" type="password" autoComplete="new-password" required />
          </label>
          <button className="primary" type="submit" disabled={working}>
            {t(working ? "setup.working" : "recovery.reset_submit")}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </AuthLayout>
  );
}
