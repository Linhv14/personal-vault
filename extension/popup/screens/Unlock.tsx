import { useEffect, useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import { rememberUnlock } from "../../lib/resume.js";
import { hasPin, PIN_MAX_LENGTH, PIN_MIN_LENGTH, PinError, unlockWithPin } from "../../lib/pin.js";
import {
  BiometricError,
  biometricLabel,
  hasBiometric,
  unlockWithBiometric,
} from "../../lib/biometric.js";
import { clearAccountData, getUnlocked, lock } from "../../lib/storage.js";
import { useT } from "../../ui/i18n.js";
import { signIn } from "../auth.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Icon } from "../../ui/components/Icon.js";
import { enterVault } from "../state.js";

export function Unlock({ email }: { email: string }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [mode, setMode] = useState<"pin" | "password" | null>(null);

  const [biometric, setBiometric] = useState(false);
  const method = t(biometricLabel());

  useEffect(() => {
    void hasPin().then((on) => setMode(on ? "pin" : "password"));
    void hasBiometric().then(setBiometric);
  }, []);

  const finish = async (vaultKeyRaw: string) => {
    await rememberUnlock(vaultKeyRaw, (await getUnlocked())?.token);
    await enterVault(vaultKeyRaw);
  };

  const useBiometric = async () => {
    setError(null);
    setWorking(true);
    try {
      await finish(await unlockWithBiometric());
    } catch (failure) {
      if (failure instanceof BiometricError && failure.code === "off") {
        setBiometric(false);
        setError(t("bio.turned_off", { method }));
      } else if (failure instanceof BiometricError && failure.code === "failed") {
        setError(t("bio.failed", { method }));
      } else if (failure instanceof BiometricError) {
        setError(t("bio.cancelled", { method }));
      } else {
        setError(describeError(failure, t));
      }
    } finally {
      setWorking(false);
    }
  };

  const submitPin = async (event: Event) => {
    event.preventDefault();
    setError(null);
    setWorking(true);
    const form = event.currentTarget as HTMLFormElement;
    try {
      await finish(await unlockWithPin(String(new FormData(form).get("pin"))));
    } catch (failure) {
      form.reset();
      if (failure instanceof PinError && failure.code === "wrong") {
        setError(t("pin.wrong", { count: failure.attemptsLeft }));
      } else if (failure instanceof PinError && failure.code === "invalid") {
        setError(t("pin.invalid", { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH }));
      } else if (failure instanceof PinError) {
        setError(t("pin.turned_off"));
        setMode("password");
      } else {
        setError(describeError(failure, t));
      }
    } finally {
      setWorking(false);
    }
  };

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
      {biometric && (
        <button
          id="bio-unlock"
          className="primary bio-button"
          type="button"
          disabled={working}
          onClick={() => void useBiometric()}
        >
          <Icon name="fingerprint" />
          {t("bio.unlock", { method })}
        </button>
      )}
      {mode === "pin" && (
        <form id="form-pin-unlock" className="stack" onSubmit={(event) => void submitPin(event)}>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={PIN_MAX_LENGTH}
            placeholder={t("pin.placeholder")}
            aria-label={t("pin.placeholder")}
            required
            autoFocus
          />
          <button className={biometric ? "secondary" : "primary"} type="submit" disabled={working}>
            {t(working ? "unlock.working" : "unlock.submit")}
          </button>
          <button
            type="button"
            className="link quiet"
            onClick={() => {
              setError(null);
              setMode("password");
            }}
          >
            {t("pin.use_password")}
          </button>
        </form>
      )}
      <form
        id="form-unlock"
        className="stack"
        hidden={mode !== "password"}
        onSubmit={(event) => void submit(event)}
      >
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t("setup.master_password")}
          required
          autoFocus={mode === "password"}
        />
        <button className={biometric ? "secondary" : "primary"} type="submit" disabled={working}>
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
