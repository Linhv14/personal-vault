import { useState } from "preact/hooks";
import { parseSecondFactor } from "../../../src/core/account-two-factor.js";
import { useT } from "../i18n.js";
import { CodeBoxes } from "./CodeBoxes.js";

export interface SecondFactorInputProps {
  onSubmit: (code: string) => Promise<void>;
  submitLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  allowBackup?: boolean;
  buttonClass?: string;
  linkClass?: string;
}

export function SecondFactorInput({
  onSubmit,
  submitLabel,
  disabled = false,
  autoFocus = true,
  allowBackup = true,
  buttonClass = "primary",
  linkClass = "link quiet",
}: SecondFactorInputProps) {
  const t = useT();
  const [backup, setBackup] = useState(false);
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const blocked = disabled || working;
  const factor = parseSecondFactor(value);
  const ready = backup ? factor?.kind === "backup" : factor?.kind === "totp";

  const submit = async (code: string) => {
    if (blocked) {
      return;
    }
    setWorking(true);
    try {
      await onSubmit(code);
    } catch {
      setValue("");
    } finally {
      setWorking(false);
    }
  };

  return (
    <form
      className="second-factor stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          void submit(value);
        }
      }}
    >
      <p className="second-factor-prompt">{t(backup ? "twofa.prompt_backup" : "twofa.prompt")}</p>
      {backup ? (
        <input
          name="backupCode"
          className="backup-code-input"
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          placeholder="xxxxx-xxxxx"
          aria-label={t("twofa.prompt_backup")}
          maxLength={16}
          disabled={blocked}
          autoFocus={autoFocus}
          onInput={(event) => setValue(event.currentTarget.value)}
        />
      ) : (
        <CodeBoxes
          value={value}
          onChange={setValue}
          onComplete={(code) => void submit(code)}
          disabled={blocked}
          autoFocus={autoFocus}
          label={t("twofa.prompt")}
        />
      )}
      <button className={buttonClass} type="submit" disabled={blocked || !ready}>
        {working ? t("twofa.verifying") : submitLabel}
      </button>
      {allowBackup && (
        <button
          type="button"
          className={linkClass}
          disabled={working}
          onClick={() => {
            setBackup(!backup);
            setValue("");
          }}
        >
          {t(backup ? "twofa.use_app" : "twofa.use_backup")}
        </button>
      )}
    </form>
  );
}
