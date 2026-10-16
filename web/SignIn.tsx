import { useEffect, useState } from "preact/hooks";
import { previewInvite, type InvitePreview } from "../extension/lib/orgs.js";
import { Wordmark } from "../extension/ui/components/Logo.js";
import { describeError } from "../src/i18n/index.js";
import { logoSvg } from "../src/ui/logo.js";
import { useT } from "../extension/ui/i18n.js";
import { signIn } from "./session.js";

function InviteContext() {
  const t = useT();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const inviteId = /^#\/invite\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
  useEffect(() => {
    if (inviteId) void previewInvite(inviteId).then(setPreview);
  }, [inviteId]);
  if (!preview) return null;
  return (
    <div className="invite-context">
      <strong>
        {preview.inviter
          ? t("invite.from", { inviter: preview.inviter, org: preview.orgName })
          : t("invite.title", { org: preview.orgName })}
      </strong>
      <span>{t("invite.sign_in_as", { email: preview.email })}</span>
    </div>
  );
}

export function SignIn() {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const password = form.elements.namedItem("password") as HTMLInputElement | null;
    setError(null);
    setWorking(true);
    try {
      const secret = String(data.get("password"));
      if (password) password.value = "";
      await signIn(String(data.get("email")).trim(), secret);
    } catch (failure) {
      setError(describeError(failure, t));
      password?.focus();
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="sign-in">
      <form className="panel sign-in-card" onSubmit={(event) => void submit(event)}>
        <header className="brand">
          <span
            className="brand-logo"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: logoSvg("web-logo") }}
          />
          <Wordmark />
        </header>
        <h1>{t("web.sign_in_title")}</h1>
        <InviteContext />
        <label className="field">
          <span className="field-label">{t("setup.email")}</span>
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t("setup.master_password")}</span>
          <input name="password" type="password" autoComplete="off" required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={working}>
          {t(working ? "web.signing_in" : "setup.sign_in")}
        </button>
        <p className="field-hint">
          {t("web.no_account")} <a href="/">{t("web.get_extension")}</a>
        </p>
      </form>
    </main>
  );
}
