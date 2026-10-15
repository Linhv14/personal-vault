import { useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import { clearAccountData, lock } from "../../lib/storage.js";
import { useT } from "../../ui/i18n.js";
import { signIn } from "../auth.js";
import { AuthLayout } from "../components/AuthLayout.js";

export function Unlock({ email }: { email: string }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      await signIn(
        email,
        String(new FormData(event.currentTarget as HTMLFormElement).get("password")),
      );
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const reset = async () => {
    if (!confirm(t("unlock.reset_confirm"))) return;
    await clearAccountData();
    await lock();
    location.reload();
  };

  return (
    <AuthLayout id="screen-unlock">
      <div className="auth-heading">
        <h1>{t("unlock.submit")}</h1>
        <p className="hint">{email}</p>
      </div>
      <form id="form-unlock" className="stack" onSubmit={(event) => void submit(event)}>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t("setup.master_password")}
          required
          autoFocus
        />
        <button className="primary" type="submit" disabled={working}>
          {t(working ? "unlock.working" : "unlock.submit")}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <button type="button" className="link quiet" onClick={() => void reset()}>
        {t("unlock.reset")}
      </button>
    </AuthLayout>
  );
}
