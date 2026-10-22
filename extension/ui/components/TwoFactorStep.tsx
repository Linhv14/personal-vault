import { useEffect, useState } from "preact/hooks";
import { describeError } from "#i18n/index.js";
import { ApiError } from "#ext/lib/api.js";
import { useT } from "../i18n.js";
import { Icon } from "./Icon.js";
import { SecondFactorInput } from "./SecondFactorInput.js";

export interface TwoFactorStepProps {
  email: string;
  verify: (code: string) => Promise<void>;
  onCancel: (message?: string) => void;
  buttonClass?: string;
  linkClass?: string;
  errorClass?: string;
}

function useCountdown(): [number, (seconds: number) => void] {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) {
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), 250);
    return () => clearTimeout(timer);
  }, [until, now]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return [
    left,
    (seconds) => {
      setNow(Date.now());
      setUntil(Date.now() + seconds * 1000);
    },
  ];
}

export function TwoFactorStep({
  email,
  verify,
  onCancel,
  buttonClass = "primary",
  linkClass = "link quiet",
  errorClass = "error",
}: TwoFactorStepProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [wait, startWait] = useCountdown();

  const submit = async (code: string) => {
    setError(null);
    try {
      await verify(code);
    } catch (failure) {
      if (failure instanceof ApiError && failure.messageKey === "error.auth.two_factor_expired") {
        onCancel(describeError(failure, t));
      } else if (failure instanceof ApiError && failure.status === 429) {
        startWait(Number(failure.params.seconds) || 1);
      } else {
        setError(describeError(failure, t));
      }
      throw failure;
    }
  };

  return (
    <div className="two-factor-step stack" id="two-factor-step">
      <div className="two-factor-head">
        <span className="two-factor-badge" aria-hidden="true">
          <Icon name="shield" />
        </span>
        <h1>{t("twofa.title")}</h1>
        <p className="hint">{email}</p>
      </div>
      <SecondFactorInput
        onSubmit={submit}
        submitLabel={t("twofa.verify")}
        disabled={wait > 0}
        buttonClass={buttonClass}
        linkClass={linkClass}
      />
      {wait > 0 && (
        <p className="two-factor-wait" role="status">
          {t("twofa.wait", { seconds: wait })}
        </p>
      )}
      {error && wait === 0 && (
        <p className={errorClass} role="alert">
          {error}
        </p>
      )}
      <button type="button" className={linkClass} onClick={() => onCancel()}>
        {t("common.back")}
      </button>
    </div>
  );
}
