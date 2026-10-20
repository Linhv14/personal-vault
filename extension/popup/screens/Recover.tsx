import { useState } from "preact/hooks";
import type { MasterPasswordIssue } from "../../../src/core/master-password.js";
import { normalizeRecoveryCode } from "../../../src/core/recovery.js";
import { describeError } from "../../../src/i18n/index.js";
import { recoverAccount, requestRecoveryEmail } from "../../lib/account-recovery.js";
import { checkNewMasterPassword } from "../../lib/master-password.js";
import { getLocal, setLocal } from "../../lib/storage.js";
import { Icon } from "../../ui/components/Icon.js";
import { MasterPasswordInput } from "../../ui/components/MasterPasswordInput.js";
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

interface Proven {
  email: string;
  code: string;
  emailRequired: boolean;
}

export function Recover({ email: initialEmail, server, onCancel }: RecoverProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [proven, setProven] = useState<Proven | null>(null);
  const [done, setDone] = useState<{ email: string; password: string; code: string } | null>(null);
  const [passwordIssue, setPasswordIssue] = useState<MasterPasswordIssue | null>(null);

  const withServer = async <T,>(email: string, action: () => Promise<T>): Promise<T> => {
    const previous = await getLocal();
    try {
      await setLocal({ apiUrl: server, email });
      return await action();
    } catch (failure) {
      if (!previous.wrappedVaultKey) await chrome.storage.local.remove("email");
      else await setLocal({ apiUrl: previous.apiUrl, email: previous.email });
      throw failure;
    }
  };

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setWorking(true);
    try {
      await action();
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const submitCode = (event: Event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(data.get("email")).trim().toLowerCase();
    const code = String(data.get("code"));
    if (!normalizeRecoveryCode(code)) {
      setError(t("recovery.invalid"));
      return;
    }
    void run(async () => {
      const emailRequired = await withServer(email, () =>
        requestRecoveryEmail(email, code, localeSignal.value),
      );
      setProven({ email, code, emailRequired });
    });
  };

  const resend = () =>
    void run(async () => {
      if (!proven) return;
      await withServer(proven.email, () =>
        requestRecoveryEmail(proven.email, proven.code, localeSignal.value),
      );
      toast(t("setup.code_resent"));
    });

  const submitPassword = (event: Event) => {
    event.preventDefault();
    if (!proven) return;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const password = String(data.get("password"));
    if (password !== String(data.get("confirm"))) {
      setError(t("setup.password_mismatch"));
      return;
    }
    const emailCode = proven.emailRequired ? String(data.get("emailCode")).trim() : undefined;
    void run(async () => {
      const issue = await checkNewMasterPassword(password, proven.email);
      if (issue) {
        setPasswordIssue(issue);
        return;
      }
      const next = await withServer(proven.email, () =>
        recoverAccount(proven.email, proven.code, password, localeSignal.value, emailCode),
      );
      setDone({ email: proven.email, password, code: next });
    });
  };

  const openVault = () =>
    void run(async () => {
      if (done) await signIn(done.email, done.password);
    });

  return (
    <AuthLayout id="screen-recover">
      <header className="title-bar">
        <button
          type="button"
          className="icon-button"
          title={t("common.back")}
          aria-label={t("common.back")}
          hidden={done !== null}
          onClick={() => {
            setError(null);
            if (proven) setProven(null);
            else onCancel();
          }}
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
            onDone={openVault}
          />
        </>
      ) : proven ? (
        <form id="form-recover-password" className="stack" onSubmit={submitPassword}>
          {proven.emailRequired && (
            <>
              <p className="hint">{t("setup.code_sent", { email: proven.email })}</p>
              <label>
                <span>{t("recovery.email_code")}</span>
                <input
                  name="emailCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="\d{6}"
                  placeholder="000000"
                  required
                  autoFocus
                />
              </label>
              <div className="code-links">
                <button type="button" className="link" onClick={resend}>
                  {t("setup.code_resend")}
                </button>
              </div>
            </>
          )}
          <label>
            <span>{t("settings.new_password")}</span>
            <MasterPasswordInput
              name="password"
              email={proven.email}
              issue={passwordIssue}
              onEdit={() => setPasswordIssue(null)}
              autoFocus={!proven.emailRequired}
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
      ) : (
        <form id="form-recover" className="stack" onSubmit={submitCode}>
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
          <button className="primary" type="submit" disabled={working}>
            {t(working ? "unlock.working" : "recovery.next")}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </AuthLayout>
  );
}
