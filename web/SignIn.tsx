import { useEffect, useState } from "preact/hooks";
import { formText } from "#ui/form-data.js";
import type { MasterPasswordIssue } from "#core/master-password.js";
import {
  api,
  checkNewMasterPassword,
  localeSignal,
  MasterPasswordInput,
  previewInvite,
  ROLE_LABEL,
  Spinner,
  TwoFactorStep,
  useT,
  Wordmark,
  type InvitePreview,
} from "#ext/web-host.js";
import { describeError } from "#i18n/index.js";
import { logoSvg } from "#ui/logo.js";
import { registerFromInvite, signIn, signInWithCode, type PendingSignIn } from "./session.js";

type Mode = "sign-in" | "register";

function inviteIdFromHash(): string | undefined {
  return /^#\/invite\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
}

export function SignIn() {
  const t = useT();
  const [inviteId] = useState(inviteIdFromHash);
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(
    inviteId ? undefined : null,
  );
  const [mode, setMode] = useState<Mode>("sign-in");
  const [verification, setVerification] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [passwordIssue, setPasswordIssue] = useState<MasterPasswordIssue | null>(null);
  const [secondFactor, setSecondFactor] = useState<PendingSignIn | null>(null);

  useEffect(() => {
    if (!inviteId) {
      return;
    }
    void Promise.all([previewInvite(inviteId), api.serverConfig(location.origin)]).then(
      ([preview, config]) => {
        setInvite(preview);
        setVerification(config.emailVerification);
        if (preview && !preview.hasAccount) {
          setMode("register");
        }
      },
    );
  }, [inviteId]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setCodeSent(false);
    setError(null);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const email = invite ? invite.email : formText(data, "email").trim();
    const password = formText(data, "password");
    setError(null);

    if (mode === "register") {
      if (password !== formText(data, "confirm")) {
        setError(t("setup.password_mismatch"));
        return;
      }
      setWorking(true);
      try {
        const issue = await checkNewMasterPassword(password, email);
        if (issue) {
          setPasswordIssue(issue);
          setCodeSent(false);
          return;
        }
        if (verification && !codeSent) {
          await api.requestVerificationCode(location.origin, email, localeSignal.value);
          setCodeSent(true);
          return;
        }
        const code = verification ? formText(data, "code").trim() : undefined;
        await registerFromInvite(email, password, inviteId ?? "", code);
      } catch (failure) {
        setError(describeError(failure, t));
      } finally {
        setWorking(false);
      }
      return;
    }

    const field = form.elements.namedItem("password") as HTMLInputElement | null;
    setWorking(true);
    try {
      if (field) {
        field.value = "";
      }
      setSecondFactor(await signIn(email, password));
    } catch (failure) {
      setError(describeError(failure, t));
      field?.focus();
    } finally {
      setWorking(false);
    }
  };

  if (invite === undefined) {
    return (
      <main className="sign-in">
        <span className="spinner" />
      </main>
    );
  }

  if (secondFactor) {
    return (
      <main className="sign-in">
        <div className="panel sign-in-card">
          <TwoFactorStep
            email={secondFactor.email}
            verify={(code) => signInWithCode(secondFactor, code)}
            onCancel={(message) => {
              setSecondFactor(null);
              setError(message ?? null);
            }}
            buttonClass="btn primary"
            linkClass="link"
            errorClass="form-error"
          />
        </div>
      </main>
    );
  }

  if (invite && !invite.domainAllowed) {
    return (
      <main className="sign-in">
        <div className="panel sign-in-card">
          <header className="brand">
            <span
              className="brand-logo"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: logoSvg("", false, true) }}
            />
            <Wordmark />
          </header>
          <h1>{t("invite.domain_title")}</h1>
          <p className="invite-lead">{t("invite.domain_text", { org: invite.orgName })}</p>
        </div>
      </main>
    );
  }

  const registering = mode === "register" && invite !== null;
  const title = invite ? t("invite.title", { org: invite.orgName }) : t("web.sign_in_title");
  const label = working
    ? t(registering ? "setup.working" : "web.signing_in")
    : registering
      ? verification && !codeSent
        ? t("setup.send_code")
        : t("invite.create_join")
      : t(invite ? "invite.sign_in_join" : "setup.sign_in");

  return (
    <main className="sign-in">
      <form className="panel sign-in-card" onSubmit={(event) => void submit(event)}>
        <header className="brand">
          <span
            className="brand-logo"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: logoSvg("", false, true) }}
          />
          <Wordmark />
        </header>
        <h1>{title}</h1>
        {invite && (
          <p className="invite-lead">
            {invite.inviter
              ? t("invite.lead", { inviter: invite.inviter, role: t(ROLE_LABEL[invite.role]) })
              : t("invite.lead_anonymous", { role: t(ROLE_LABEL[invite.role]) })}
          </p>
        )}
        <label className="field">
          <span className="field-label">{t("setup.email")}</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus={!invite}
            readOnly={invite !== null}
            value={invite?.email}
          />
        </label>
        {registering && codeSent && (
          <label className="field">
            <span className="field-label">{t("invite.code")}</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              placeholder="000000"
              required
              autoFocus
            />
            <span className="field-hint">{t("setup.code_sent", { email: invite.email })}</span>
          </label>
        )}
        <label className="field" hidden={registering && codeSent}>
          <span className="field-label">{t("setup.master_password")}</span>
          {registering ? (
            <MasterPasswordInput
              name="password"
              email={invite.email}
              issue={passwordIssue}
              onEdit={() => setPasswordIssue(null)}
              autoFocus
            />
          ) : (
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus={invite !== null}
            />
          )}
        </label>
        {registering && (
          <label className="field" hidden={codeSent}>
            <span className="field-label">{t("setup.confirm")}</span>
            <input name="confirm" type="password" autoComplete="new-password" required />
            <span className="field-hint">{t("setup.hint_create")}</span>
          </label>
        )}
        <div className="turnstile-slot" data-turnstile />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn primary"
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
        >
          {working && <Spinner />}
          {label}
        </button>
        <p className="field-hint">
          {invite ? (
            registering ? (
              <>
                {t("invite.have_account")}{" "}
                <button type="button" className="link" onClick={() => switchMode("sign-in")}>
                  {t("setup.sign_in")}
                </button>
              </>
            ) : (
              <>
                {t("web.no_account")}{" "}
                <button type="button" className="link" onClick={() => switchMode("register")}>
                  {t("invite.create_account")}
                </button>
              </>
            )
          ) : (
            <>
              {t("web.no_account")} <a href="/">{t("web.get_extension")}</a>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
