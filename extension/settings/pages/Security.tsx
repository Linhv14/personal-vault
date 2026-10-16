import { useEffect, useState } from "preact/hooks";
import { rewrapVaultKey } from "../../../src/core/crypto.js";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
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
import { getLocal, lock, setLocal } from "../../lib/storage.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { useT } from "../../ui/i18n.js";
import { vaultKeyRawSignal, vaultKeySignal } from "../../ui/store/session.js";
import { currentAuthKey, reloadLocal, showToast } from "../state.js";

export function Security() {
  const t = useT();
  const vaultKey = vaultKeySignal.value;
  const [changeError, setChangeError] = useState<string | null>(null);

  const handleChangePassword = async (event: Event) => {
    event.preventDefault();
    setChangeError(null);
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next = String(data.get("next"));
    const vaultKeyRaw = vaultKeyRawSignal.value;
    if (next !== String(data.get("confirm"))) {
      setChangeError(t("setup.password_mismatch"));
      return;
    }
    if (!vaultKeyRaw) {
      setChangeError(t("settings.locked_hint"));
      return;
    }
    const authKey = await currentAuthKey(String(data.get("current")));
    const { email } = await getLocal();
    if (!authKey || !email) {
      setChangeError(t("settings.wrong_current"));
      return;
    }
    try {
      const record = await rewrapVaultKey(email, next, vaultKeyRaw);
      await api.changePassword(authKey, record);
      await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
      await lock();
      form.reset();
      showToast(t("settings.changed"));
      await reloadLocal();
    } catch (error) {
      setChangeError(describeError(error, t));
    }
  };

  return (
    <section className="page">
      <h1>{t("settings.section_security")}</h1>
      <BiometricCard unlocked={Boolean(vaultKey)} />
      <PinCard unlocked={Boolean(vaultKey)} />
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
            <input
              name="next"
              type="password"
              minLength={12}
              autoComplete="new-password"
              placeholder={t("settings.new_password")}
              required
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
            <Button variant="primary" type="submit">
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
    const pin = String(data.get("pin"));
    if (!isValidPin(pin)) {
      setError(t("pin.invalid", { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH }));
      return;
    }
    if (pin !== String(data.get("confirm"))) {
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

  if (on === null) return null;
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

  if (!state) return null;
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
