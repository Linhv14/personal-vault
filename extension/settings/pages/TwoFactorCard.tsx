import { useEffect, useState } from "preact/hooks";
import { groupSecret } from "../../../src/core/account-two-factor.js";
import { describeError } from "../../../src/i18n/index.js";
import { getLocal } from "../../lib/storage.js";
import {
  disableTwoFactor,
  enableTwoFactor,
  replaceBackupCodes,
  startTwoFactor,
  twoFactorStatus,
  type TwoFactorStatus,
} from "../../lib/two-factor.js";
import { BackupCodesView } from "../../ui/components/BackupCodesView.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Icon } from "../../ui/components/Icon.js";
import { QrCode } from "../../ui/components/QrCode.js";
import { SecondFactorInput } from "../../ui/components/SecondFactorInput.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { currentAuthKey, showToast } from "../state.js";

type Purpose = "enable" | "disable" | "codes";

type Step =
  | { kind: "password"; purpose: Purpose }
  | { kind: "scan"; authKey: string; secret: string; uri: string }
  | { kind: "code"; purpose: Exclude<Purpose, "enable">; authKey: string }
  | { kind: "codes"; codes: string[]; email: string; server: string; createdAt: number };

const PURPOSE_LABEL = {
  enable: "twofa.turn_on",
  disable: "twofa.turn_off",
  codes: "twofa.new_codes",
} as const;

export function TwoFactorCard({ unlocked }: { unlocked: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<TwoFactorStatus | undefined>(undefined);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = () => twoFactorStatus().then(setStatus, () => setStatus(undefined));

  useEffect(() => {
    if (unlocked) void refresh();
  }, [unlocked]);

  const close = () => {
    setStep(null);
    setError(null);
  };

  const showCodes = async (codes: string[]) => {
    const { email, apiUrl } = await getLocal();
    setStep({
      kind: "codes",
      codes,
      email: email ?? "",
      server: apiUrl ?? "",
      createdAt: Math.floor(Date.now() / 1000),
    });
  };

  const submitPassword = async (event: Event, purpose: Purpose) => {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      const form = event.currentTarget as HTMLFormElement;
      const authKey = await currentAuthKey(String(new FormData(form).get("current")));
      if (!authKey) {
        setError(t("settings.wrong_current"));
        return;
      }
      if (purpose === "enable")
        setStep({ kind: "scan", authKey, ...(await startTwoFactor(authKey)) });
      else setStep({ kind: "code", purpose, authKey });
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const confirm = async (code: string) => {
    if (step?.kind !== "scan" && step?.kind !== "code") return;
    setError(null);
    try {
      if (step.kind === "scan") {
        const { backupCodes } = await enableTwoFactor(step.authKey, code, localeSignal.value);
        showToast(t("twofa.enabled"));
        await showCodes(backupCodes);
      } else if (step.purpose === "disable") {
        await disableTwoFactor(step.authKey, code, localeSignal.value);
        showToast(t("twofa.disabled"));
        close();
      } else {
        await showCodes(await replaceBackupCodes(step.authKey, code));
      }
      await refresh();
    } catch (failure) {
      setError(describeError(failure, t));
      throw failure;
    }
  };

  const copySecret = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    showToast(t("twofa.key_copied"));
  };

  const on = status?.enabled ?? false;
  return (
    <Card>
      <div className="two-factor-title">
        <h2>{t("twofa.title")}</h2>
        {status && (
          <span className={`status-chip ${on ? "on" : "off"}`} id="two-factor-status">
            {t(on ? "twofa.on" : "twofa.off")}
          </span>
        )}
      </div>
      {!unlocked ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : status === undefined ? null : step?.kind === "codes" ? (
        <BackupCodesView
          {...step}
          onCopied={() => showToast(t("twofa.codes_copied"))}
          onDone={close}
        />
      ) : step?.kind === "password" ? (
        <form
          className="stack"
          id="form-two-factor-password"
          onSubmit={(event) => void submitPassword(event, step.purpose)}
        >
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            placeholder={t("settings.current_password")}
            aria-label={t("settings.current_password")}
            required
            autoFocus
          />
          <div className="actions">
            <Button
              variant={step.purpose === "disable" ? "danger" : "primary"}
              type="submit"
              disabled={working}
            >
              {t(PURPOSE_LABEL[step.purpose])}
            </Button>
            <Button type="button" onClick={close}>
              {t("pin.cancel")}
            </Button>
          </div>
        </form>
      ) : step?.kind === "scan" ? (
        <div className="two-factor-setup">
          <div className="two-factor-qr">
            <QrCode value={step.uri} label={t("twofa.scan")} />
            <span className="row-hint">{t("twofa.scan")}</span>
          </div>
          <div className="two-factor-confirm stack">
            <span className="row-hint">{t("twofa.manual")}</span>
            <div className="secret-key">
              <code id="two-factor-secret">{groupSecret(step.secret)}</code>
              <button
                type="button"
                className="icon-button"
                title={t("common.copy")}
                aria-label={t("common.copy")}
                onClick={() => void copySecret(step.secret)}
              >
                <Icon name="copy" />
              </button>
            </div>
            <SecondFactorInput
              onSubmit={confirm}
              submitLabel={t("twofa.turn_on")}
              allowBackup={false}
              buttonClass="button primary"
            />
            <Button type="button" onClick={close}>
              {t("pin.cancel")}
            </Button>
          </div>
        </div>
      ) : step?.kind === "code" ? (
        <div className="two-factor-code stack">
          <SecondFactorInput
            onSubmit={confirm}
            submitLabel={t(PURPOSE_LABEL[step.purpose])}
            buttonClass={step.purpose === "disable" ? "button danger" : "button primary"}
            linkClass="button quiet"
          />
          <Button type="button" onClick={close}>
            {t("pin.cancel")}
          </Button>
        </div>
      ) : on ? (
        <div className="actions">
          <span className="row-hint two-factor-left">
            {t("twofa.codes_left", { count: status.backupCodesLeft })}
          </span>
          <Button
            id="two-factor-codes"
            onClick={() => setStep({ kind: "password", purpose: "codes" })}
          >
            {t("twofa.new_codes")}
          </Button>
          <Button
            id="two-factor-disable"
            onClick={() => setStep({ kind: "password", purpose: "disable" })}
          >
            {t("twofa.turn_off")}
          </Button>
        </div>
      ) : (
        <div className="actions">
          <Button
            variant="primary"
            id="two-factor-enable"
            onClick={() => setStep({ kind: "password", purpose: "enable" })}
          >
            {t("twofa.turn_on")}
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
