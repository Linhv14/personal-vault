import { useEffect, useRef, useState } from "preact/hooks";
import { createAccount } from "../../../src/core/crypto.js";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import {
  clearPendingSignup,
  getLocal,
  loadPendingSignup,
  savePendingSignup,
  setLocal,
  type PendingSignup,
} from "../../lib/storage.js";
import { isDefaultServer } from "../../lib/server.js";
import { Icon } from "../../ui/components/Icon.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { finishUnlock, signIn } from "../auth.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { toast } from "../state.js";
import { Recover } from "./Recover.js";

type Mode = "register" | "login";

export interface SetupProps {
  apiUrl: string;
  defaultServer: string;
  signup: PendingSignup | null;
}

const configRequests = new Map<string, Promise<api.ServerConfig>>();

function serverConfigFor(url: string): Promise<api.ServerConfig> {
  let request = configRequests.get(url);
  if (!request) {
    request = api.serverConfig(url);
    configRequests.set(url, request);
  }
  return request;
}

export function Setup({ apiUrl, defaultServer, signup }: SetupProps) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [choosing, setChoosing] = useState(signup === null);
  const [mode, setMode] = useState<Mode>("register");
  const [customServer, setCustomServer] = useState(
    !defaultServer || (signup !== null && !isDefaultServer(signup.apiUrl, defaultServer)),
  );
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(signup?.email ?? null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [recovering, setRecovering] = useState<{ email: string; server: string } | null>(null);

  const registering = mode === "register";
  const codeStep = registering && verificationRequired && codeSentTo !== null;
  const askPassword = !registering || !verificationRequired || codeStep;
  const askServer = customServer && !codeStep;

  const field = (name: string) => {
    const element = form.current?.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element : null;
  };

  const applyServerConfig = async (): Promise<boolean> => {
    const config = await serverConfigFor(field("apiUrl")?.value.trim() ?? "");
    setRegistrationOpen(config.registrationOpen);
    setVerificationRequired(config.emailVerification);
    return config.emailVerification;
  };

  useEffect(() => {
    void applyServerConfig().then(() => {
      if (signup) setFocusTarget("verificationCode");
    });
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    field(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const openForm = async (next: Mode) => {
    const required = await applyServerConfig();
    setMode(next);
    setError(null);
    setChoosing(false);
    setFocusTarget(next === "register" && required && codeSentTo ? "verificationCode" : "email");
  };

  const leaveCodeStep = async () => {
    setCodeSentTo(null);
    await clearPendingSignup();
  };

  const buttonLabel = working
    ? t("setup.working")
    : !registering
      ? t("setup.sign_in")
      : verificationRequired && !codeSentTo
        ? t("setup.send_code")
        : t("setup.create");

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget as HTMLFormElement);

    let required = verificationRequired;
    if (!codeSentTo) {
      required = await applyServerConfig();
      if (required !== verificationRequired) return;
    }

    const server = String(data.get("apiUrl")).trim().replace(/\/$/, "");
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password"));

    if (registering && password !== String(data.get("confirm"))) {
      setError(t("setup.password_mismatch"));
      return;
    }

    setWorking(true);
    try {
      if (registering && required && !codeSentTo) {
        await api.requestVerificationCode(server, email, localeSignal.value);
        const registrationToken = String(data.get("registrationToken") ?? "");
        await savePendingSignup({ apiUrl: server, email, registrationToken, sentAt: Date.now() });
        setCodeSentTo(email);
        setFocusTarget("verificationCode");
        return;
      }
      await setLocal({ apiUrl: server, email });
      if (registering) {
        const { record } = await createAccount(email, password);
        const { token } = await api.register(
          email,
          record,
          String(data.get("registrationToken")),
          required ? String(data.get("verificationCode")).trim() : undefined,
        );
        await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
        await clearPendingSignup();
        await finishUnlock(email, password, record.kdf, record.wrappedVaultKey, token);
      } else {
        await signIn(email, password);
      }
    } catch (failure) {
      if (!(await getLocal()).wrappedVaultKey) await chrome.storage.local.remove("email");
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const resendCode = async () => {
    setError(null);
    const pending = await loadPendingSignup();
    if (!pending) {
      await leaveCodeStep();
      return;
    }
    try {
      await api.requestVerificationCode(pending.apiUrl, pending.email, localeSignal.value);
      await savePendingSignup({ ...pending, sentAt: Date.now() });
      toast(t("setup.code_resent"));
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  if (recovering) {
    return (
      <Recover
        email={recovering.email}
        server={recovering.server}
        onCancel={() => setRecovering(null)}
      />
    );
  }

  return (
    <AuthLayout id="screen-setup">
      <div id="setup-choice" hidden={!choosing}>
        <div className="choices">
          <button className="choice" onClick={() => void openForm("register")}>
            <span className="choice-icon">
              <Icon name="plus" />
            </span>
            <span className="choice-text">
              <strong>{t("setup.mode_create")}</strong>
              <small>{t("setup.mode_create_hint")}</small>
            </span>
          </button>
          <button className="choice" onClick={() => void openForm("login")}>
            <span className="choice-icon">
              <Icon name="lock" />
            </span>
            <span className="choice-text">
              <strong>{t("setup.mode_signin")}</strong>
              <small>{t("setup.mode_signin_hint")}</small>
            </span>
          </button>
        </div>
      </div>
      <div hidden={choosing}>
        <header className="title-bar">
          <button
            type="button"
            className="icon-button"
            title={t("common.back")}
            aria-label={t("common.back")}
            onClick={() => {
              void leaveCodeStep();
              setChoosing(true);
            }}
          >
            <Icon name="back" />
          </button>
          <h1>{t(registering ? "setup.mode_create" : "setup.mode_signin")}</h1>
        </header>
        <form id="form-setup" className="stack" ref={form} onSubmit={(event) => void submit(event)}>
          <label hidden={!askServer}>
            <span>{t("setup.server")}</span>
            <input
              name="apiUrl"
              type="url"
              placeholder="https://personal-vault.you.workers.dev"
              defaultValue={signup?.apiUrl ?? (customServer ? apiUrl : defaultServer)}
              required={askServer}
              onChange={() => void applyServerConfig()}
            />
          </label>
          <label hidden={codeStep}>
            <span>{t("setup.email")}</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={signup?.email ?? ""}
              required={!codeStep}
            />
          </label>
          <label hidden={!registering || registrationOpen || codeStep}>
            <span>{t("setup.registration_token")}</span>
            <input
              name="registrationToken"
              type="password"
              autoComplete="off"
              placeholder={t("setup.registration_token_hint")}
              defaultValue={signup?.registrationToken ?? ""}
              required={registering && !registrationOpen && !codeStep}
            />
          </label>
          <div className="code-step" hidden={!codeStep}>
            <p className="hint">{codeStep ? t("setup.code_sent", { email: codeSentTo }) : ""}</p>
            <input
              name="verificationCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              placeholder="000000"
              required={codeStep}
            />
            <div className="code-links">
              <button type="button" className="link" onClick={() => void resendCode()}>
                {t("setup.code_resend")}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  void leaveCodeStep();
                  setFocusTarget("email");
                }}
              >
                {t("setup.code_change_email")}
              </button>
            </div>
          </div>
          <label hidden={!askPassword}>
            <span>{t("setup.master_password")}</span>
            <input
              name="password"
              type="password"
              autoComplete={registering ? "new-password" : "current-password"}
              minLength={registering ? 12 : 0}
              required={askPassword}
            />
          </label>
          <label hidden={!askPassword || !registering}>
            <span>{t("setup.confirm")}</span>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required={askPassword && registering}
            />
          </label>
          <p className="hint" hidden={!(registering && askPassword)}>
            {t("setup.hint_create")}
          </p>
          <button className="primary" type="submit" disabled={working}>
            {buttonLabel}
          </button>
          <button
            type="button"
            className="link quiet"
            id="forgot-password"
            hidden={registering}
            onClick={() =>
              setRecovering({
                email: field("email")?.value.trim() ?? "",
                server: (field("apiUrl")?.value.trim() ?? "").replace(/\/$/, ""),
              })
            }
          >
            {t("recovery.forgot")}
          </button>
          <button
            type="button"
            className="link quiet"
            hidden={askServer || codeStep || !defaultServer}
            onClick={() => {
              const input = field("apiUrl");
              if (input && apiUrl && !isDefaultServer(apiUrl, defaultServer)) {
                input.value = apiUrl;
                void applyServerConfig();
              }
              setCustomServer(true);
              setFocusTarget("apiUrl");
            }}
          >
            {t("setup.custom_server")}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </AuthLayout>
  );
}
