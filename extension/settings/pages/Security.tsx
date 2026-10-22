import { useEffect, useState } from "preact/hooks";
import { formText } from "../../../src/ui/form-data.js";
import { rewrapVaultKey } from "../../../src/core/crypto.js";
import type { MasterPasswordIssue } from "../../../src/core/master-password.js";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import {
  createRecoveryCode,
  recoveryCreatedAt,
  removeRecoveryCode,
} from "../../lib/account-recovery.js";
import {
  biometricLabel,
  biometricSetupHint,
  biometricSupported,
  disableBiometric,
  enableBiometric,
  hasBiometric,
} from "../../lib/biometric.js";
import {
  disablePin,
  enablePin,
  hasPin,
  isValidPin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "../../lib/pin.js";
import { checkNewMasterPassword } from "../../lib/master-password.js";
import { getLocal, lock, setLocal } from "../../lib/storage.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { MasterPasswordInput } from "../../ui/components/MasterPasswordInput.js";
import { RecoveryCodeView } from "../../ui/components/RecoveryCodeView.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { vaultKeyRawSignal, vaultKeySignal } from "../../ui/store/session.js";
import { currentAuthKey, reloadLocal, showToast } from "../state.js";
import { TwoFactorCard } from "./TwoFactorCard.js";

export function Security() {
  const t = useT();
  const vaultKey = vaultKeySignal.value;
  const [changeError, setChangeError] = useState<string | null>(null);
  const [passwordIssue, setPasswordIssue] = useState<MasterPasswordIssue | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    void getLocal().then(({ email }) => setAccountEmail(email ?? ""));
  }, []);

  const handleChangePassword = async (event: Event) => {
    event.preventDefault();
    setChangeError(null);
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next = formText(data, "next");
    const vaultKeyRaw = vaultKeyRawSignal.value;
    if (next !== formText(data, "confirm")) {
      setChangeError(t("setup.password_mismatch"));
      return;
    }
    if (!vaultKeyRaw) {
      setChangeError(t("settings.locked_hint"));
      return;
    }
    const authKey = await currentAuthKey(formText(data, "current"));
    const { email } = await getLocal();
    if (!authKey || !email) {
      setChangeError(t("settings.wrong_current"));
      return;
    }
    setChanging(true);
    try {
      const issue = await checkNewMasterPassword(next, email);
      if (issue) {
        setPasswordIssue(issue);
        return;
      }
      const record = await rewrapVaultKey(email, next, vaultKeyRaw);
      await api.changePassword(authKey, record);
      await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
      await lock();
      form.reset();
      showToast(t("settings.changed"));
      await reloadLocal();
    } catch (error) {
      setChangeError(describeError(error, t));
    } finally {
      setChanging(false);
    }
  };

  return (
    <section className="page">
      <h1>{t("settings.section_security")}</h1>
      <BiometricCard unlocked={Boolean(vaultKey)} />
      <PinCard unlocked={Boolean(vaultKey)} />
      <TwoFactorCard unlocked={Boolean(vaultKey)} />
      <RecoveryCard unlocked={Boolean(vaultKey)} />
      <Card>
        <h2>{t("settings.change_password")}</h2>
        <p className="row-hint">{t("settings.change_hint")}</p>
        {!vaultKey ? (
          <p className="notice">{t("settings.locked_hint")}</p>
        ) : (
          <form className="stack" onSubmit={(event) => void handleChangePassword(event)}>
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              placeholder={t("settings.current_password")}
              required
            />
            <MasterPasswordInput
              name="next"
              email={accountEmail}
              issue={passwordIssue}
              onEdit={() => setPasswordIssue(null)}
              placeholder={t("settings.new_password")}
              ariaLabel={t("settings.new_password")}
            />
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              placeholder={t("setup.confirm")}
              required
            />
            {changeError && (
              <p className="error" role="alert">
                {changeError}
              </p>
            )}
            <Button variant="primary" type="submit" disabled={changing}>
              {t("settings.change_submit")}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}

function PinCard({ unlocked }: { unlocked: boolean }) {
  const t = useT();
  const [on, setOn] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void hasPin().then(setOn);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const pin = formText(data, "pin");
    if (!isValidPin(pin)) {
      setError(t("pin.invalid", { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH }));
      return;
    }
    if (pin !== formText(data, "confirm")) {
      setError(t("pin.mismatch"));
      return;
    }
    setWorking(true);
    try {
      await enablePin(pin);
      form.reset();
      setEditing(false);
      setOn(true);
      showToast(t("pin.enabled"));
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const turnOff = async () => {
    await disablePin();
    setOn(false);
    showToast(t("pin.disabled"));
  };

  if (on === null) {
    return null;
  }
  return (
    <Card>
      <h2>{t("pin.title")}</h2>
      <p className="row-hint">{t("pin.hint")}</p>
      {on ? (
        <div className="actions">
          <span className="pin-state">{t("pin.on")}</span>
          <Button onClick={() => void turnOff()}>{t("pin.turn_off")}</Button>
        </div>
      ) : !unlocked ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : editing ? (
        <form className="stack" id="form-pin" onSubmit={(event) => void submit(event)}>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_MAX_LENGTH}
            placeholder={t("pin.new")}
            aria-label={t("pin.new")}
            required
            autoFocus
          />
          <input
            name="confirm"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_MAX_LENGTH}
            placeholder={t("pin.confirm")}
            aria-label={t("pin.confirm")}
            required
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <Button variant="primary" type="submit" disabled={working}>
              {t("pin.save")}
            </Button>
            <Button type="button" onClick={() => setEditing(false)}>
              {t("pin.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <Button variant="primary" onClick={() => setEditing(true)}>
            {t("pin.set_up")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function BiometricCard({ unlocked }: { unlocked: boolean }) {
  const t = useT();
  const method = t(biometricLabel());
  const [state, setState] = useState<{ on: boolean; supported: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void Promise.all([hasBiometric(), biometricSupported()]).then(([on, supported]) =>
      setState({ on, supported }),
    );
  }, []);

  const turnOn = async () => {
    setError(null);
    setWorking(true);
    try {
      await enableBiometric();
      setState({ on: true, supported: true });
      showToast(t("bio.enabled", { method }));
    } catch (failure) {
      setError(
        failure instanceof Error && failure.name === "BiometricError"
          ? t("bio.cancelled", { method })
          : describeError(failure, t),
      );
    } finally {
      setWorking(false);
    }
  };

  const turnOff = async () => {
    await disableBiometric();
    setState({ on: false, supported: state?.supported ?? true });
    showToast(t("bio.disabled", { method }));
  };

  if (!state) {
    return null;
  }
  return (
    <Card>
      <h2>{t("bio.title", { method })}</h2>
      <p className="row-hint">{t("bio.hint", { method })}</p>
      {state.on ? (
        <div className="actions">
          <span className="pin-state">{t("bio.on", { method })}</span>
          <Button onClick={() => void turnOff()}>{t("pin.turn_off")}</Button>
        </div>
      ) : !state.supported ? (
        <p className="notice">
          {t("bio.unsupported", { method })} {t(biometricSetupHint())}
        </p>
      ) : !unlocked ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : (
        <div className="actions">
          <Button
            variant="primary"
            id="bio-enable"
            disabled={working}
            onClick={() => void turnOn()}
          >
            {t("bio.turn_on", { method })}
          </Button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

function RecoveryCard({ unlocked }: { unlocked: boolean }) {
  const t = useT();
  const [createdAt, setCreatedAt] = useState<number | null | undefined>(undefined);
  const [asking, setAsking] = useState<"create" | "remove" | null>(null);
  const [revealed, setRevealed] = useState<{
    code: string;
    email: string;
    server: string;
    createdAt: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!unlocked) {
      return;
    }
    recoveryCreatedAt().then(setCreatedAt, () => setCreatedAt(undefined));
  }, [unlocked]);

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget as HTMLFormElement;
    const vaultKeyRaw = vaultKeyRawSignal.value;
    if (!vaultKeyRaw) {
      setError(t("settings.locked_hint"));
      return;
    }
    if (asking === "remove" && !confirm(t("recovery.remove_confirm"))) {
      return;
    }
    setWorking(true);
    try {
      const authKey = await currentAuthKey(formText(new FormData(form), "current"));
      if (!authKey) {
        setError(t("settings.wrong_current"));
        return;
      }
      if (asking === "remove") {
        await removeRecoveryCode(authKey);
        setCreatedAt(null);
        showToast(t("recovery.removed"));
      } else {
        const created = await createRecoveryCode(authKey, vaultKeyRaw);
        const { email, apiUrl } = await getLocal();
        setRevealed({ ...created, email: email ?? "", server: apiUrl ?? "" });
        setCreatedAt(created.createdAt);
      }
      form.reset();
      setAsking(null);
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card>
      <h2>{t("recovery.title")}</h2>
      <p className="row-hint">{t("recovery.hint")}</p>
      {revealed ? (
        <RecoveryCodeView
          {...revealed}
          doneLabel={t("recovery.saved")}
          onCopied={() => showToast(t("recovery.copied"))}
          onDone={() => setRevealed(null)}
        />
      ) : !unlocked ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : createdAt === undefined ? null : asking ? (
        <form className="stack" id="form-recovery" onSubmit={(event) => void submit(event)}>
          {asking === "create" && createdAt !== null && (
            <p className="row-hint">{t("recovery.replace_hint")}</p>
          )}
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            placeholder={t("settings.current_password")}
            aria-label={t("settings.current_password")}
            required
            autoFocus
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <Button
              variant={asking === "remove" ? "danger" : "primary"}
              type="submit"
              disabled={working}
            >
              {t(
                asking === "remove"
                  ? "recovery.remove"
                  : createdAt === null
                    ? "recovery.create"
                    : "recovery.replace",
              )}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAsking(null);
                setError(null);
              }}
            >
              {t("pin.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="actions">
          {createdAt !== null && (
            <span className="pin-state">
              {t("recovery.created", { date: formatDateTime(createdAt, localeSignal.value) })}
            </span>
          )}
          {createdAt === null && <span className="pin-state">{t("recovery.none")}</span>}
          <Button
            variant={createdAt === null ? "primary" : "default"}
            id="recovery-create"
            onClick={() => setAsking("create")}
          >
            {t(createdAt === null ? "recovery.create" : "recovery.replace")}
          </Button>
          {createdAt !== null && (
            <Button onClick={() => setAsking("remove")}>{t("recovery.remove")}</Button>
          )}
        </div>
      )}
    </Card>
  );
}
