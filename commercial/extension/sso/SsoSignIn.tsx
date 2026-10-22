import { useEffect, useState } from "preact/hooks";
import { createAccount, type KdfParams, type SealedData } from "#core/crypto.js";
import type { MasterPasswordIssue } from "#core/master-password.js";
import { describeError, type MessageKey } from "#i18n/index.js";
import { en } from "#i18n/en.js";
import { formText } from "#ui/form-data.js";
import * as api from "#ext/lib/api.js";
import { checkNewMasterPassword } from "#ext/lib/master-password.js";
import { MasterPasswordInput } from "#ext/ui/components/MasterPasswordInput.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { readOutcome } from "#commercial/core/sso-model.js";
import { newVerifier, prepareSso, startSsoSession, type SsoSession } from "./api.js";

export interface SsoHost {
  apiUrl: string;
  returnTo: string;
  launch(authorizeUrl: string, verifier: string): Promise<string | null>;
  openVault(
    email: string,
    password: string,
    kdf: KdfParams,
    wrapped: SealedData,
    token: string,
  ): Promise<void>;
}

export interface SsoSignInProps {
  host: SsoHost;
  initial?: string;
  autoStart?: boolean;
  resume?: { url: string; verifier: string } | null;
  expectedEmail?: string;
  delegate?: (lookup: string) => void;
  variant?: "popup" | "web";
  onCancel: () => void;
}

type Step =
  | { kind: "start" }
  | { kind: "waiting" }
  | { kind: "unlock"; session: Extract<SsoSession, { status: "signed_in" }> }
  | { kind: "create"; session: Extract<SsoSession, { status: "register" }> };

export function outcomeMessage(code: string): MessageKey {
  const key = `error.${code}`;
  return key in en ? (key as MessageKey) : "error.sso.failed";
}

export function SsoSignIn({
  host,
  initial = "",
  autoStart = false,
  resume = null,
  expectedEmail,
  delegate,
  variant = "popup",
  onCancel,
}: SsoSignInProps) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: resume || autoStart ? "waiting" : "start" });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [passwordIssue, setPasswordIssue] = useState<MasterPasswordIssue | null>(null);
  const web = variant === "web";
  const css = {
    form: web ? "panel sign-in-card" : "stack",
    field: web ? "field" : "",
    label: web ? "field-label" : "",
    hint: web ? "field-hint" : "hint",
    error: web ? "form-error" : "error form-error",
    primary: web ? "btn primary" : "primary",
    link: web ? "link" : "link quiet",
  };

  const fail = (failure: unknown) => {
    setError(describeError(failure, t));
    setStep({ kind: "start" });
  };

  const complete = async (url: string, verifier: string) => {
    const outcome = readOutcome(url);
    if (!outcome?.grant) {
      setError(t(outcomeMessage(outcome?.error ?? "sso.failed")));
      setStep({ kind: "start" });
      return;
    }
    const session = await startSsoSession(host.apiUrl, outcome.grant, verifier, localeSignal.value);
    if (expectedEmail && session.email !== expectedEmail) {
      setError(t("sso.wrong_account", { email: session.email }));
      setStep({ kind: "start" });
      return;
    }
    setStep(
      session.status === "signed_in" ? { kind: "unlock", session } : { kind: "create", session },
    );
  };

  const start = async (lookup: string) => {
    setError(null);
    if (delegate) {
      delegate(lookup);
      return;
    }
    setStep({ kind: "waiting" });
    try {
      const verifier = newVerifier();
      const prepared = await prepareSso(host.apiUrl, lookup, host.returnTo, verifier);
      const url = await host.launch(prepared.authorizeUrl, verifier);
      if (url !== null) {
        await complete(url, verifier);
      }
    } catch (failure) {
      fail(failure instanceof api.ApiError ? failure : new api.ApiError("error.sso.failed", 0));
    }
  };

  useEffect(() => {
    if (resume) {
      void complete(resume.url, resume.verifier).catch(fail);
    } else if (autoStart && initial) {
      void start(initial);
    }
  }, []);

  const unlock = async (event: Event) => {
    event.preventDefault();
    if (step.kind !== "unlock") {
      return;
    }
    const { email, kdf, wrappedVaultKey, token } = step.session;
    const password = formText(new FormData(event.currentTarget as HTMLFormElement), "password");
    setError(null);
    setWorking(true);
    try {
      await host.openVault(email, password, kdf, wrappedVaultKey, token);
    } catch (failure) {
      const wrongPassword = failure instanceof DOMException && failure.name === "OperationError";
      setError(wrongPassword ? t("error.crypto.wrong_password") : describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const create = async (event: Event) => {
    event.preventDefault();
    if (step.kind !== "create") {
      return;
    }
    const { email, registrationGrant } = step.session;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const password = formText(data, "password");
    setError(null);
    if (password !== formText(data, "confirm")) {
      setError(t("setup.password_mismatch"));
      return;
    }
    setWorking(true);
    try {
      const issue = await checkNewMasterPassword(password, email);
      if (issue) {
        setPasswordIssue(issue);
        return;
      }
      const { record } = await createAccount(email, password);
      const { token } = await api.register(
        email,
        record,
        "",
        undefined,
        undefined,
        registrationGrant,
      );
      await host.openVault(email, password, record.kdf, record.wrappedVaultKey, token);
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const errorLine = error && (
    <p className={css.error} role="alert">
      {error}
    </p>
  );
  const cancel = (
    <button type="button" className={css.link} onClick={onCancel}>
      {t("sso.use_password")}
    </button>
  );

  if (step.kind === "waiting") {
    return (
      <div className={css.form} id="sso-waiting">
        <h1>{t("sso.title")}</h1>
        <p className={css.hint}>{t("sso.waiting")}</p>
        {cancel}
      </div>
    );
  }

  if (step.kind === "unlock") {
    return (
      <form id="form-sso-unlock" className={css.form} onSubmit={(event) => void unlock(event)}>
        <h1>{t("sso.unlock_title")}</h1>
        <p className={css.hint}>{t("sso.unlock_lead", { email: step.session.email })}</p>
        <label className={css.field}>
          <span className={css.label}>{t("setup.master_password")}</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        {errorLine}
        <button className={css.primary} type="submit" disabled={working}>
          {t(working ? "unlock.working" : "unlock.submit")}
        </button>
        {cancel}
      </form>
    );
  }

  if (step.kind === "create") {
    const { email, orgName } = step.session;
    return (
      <form id="form-sso-create" className={css.form} onSubmit={(event) => void create(event)}>
        <h1>{t("sso.create_title")}</h1>
        <p className={css.hint}>{t("sso.create_lead", { org: orgName, email })}</p>
        <label className={css.field}>
          <span className={css.label}>{t("setup.master_password")}</span>
          <MasterPasswordInput
            name="password"
            email={email}
            issue={passwordIssue}
            onEdit={() => setPasswordIssue(null)}
            autoFocus
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t("setup.confirm")}</span>
          <input name="confirm" type="password" autoComplete="new-password" required />
        </label>
        <p className={css.hint}>{t("setup.hint_create")}</p>
        <div className="turnstile-slot" data-turnstile />
        {errorLine}
        <button className={css.primary} type="submit" disabled={working}>
          {t(working ? "setup.working" : "sso.create")}
        </button>
        {cancel}
      </form>
    );
  }

  return (
    <form
      id="form-sso"
      className={css.form}
      onSubmit={(event) => {
        event.preventDefault();
        void start(formText(new FormData(event.currentTarget), "lookup").trim());
      }}
    >
      <h1>{t("sso.title")}</h1>
      <p className={css.hint}>{t("sso.lead")}</p>
      <label className={css.field}>
        <span className={css.label}>{t("sso.lookup")}</span>
        <input
          name="lookup"
          autoComplete="username"
          defaultValue={initial}
          placeholder="you@company.com"
          spellcheck={false}
          required
          autoFocus
        />
      </label>
      {errorLine}
      <button className={css.primary} type="submit">
        {t("sso.continue")}
      </button>
      {cancel}
    </form>
  );
}
