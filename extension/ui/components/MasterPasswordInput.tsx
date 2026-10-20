import { useState } from "preact/hooks";
import { rateStrength } from "../../../src/core/generator.js";
import {
  MASTER_PASSWORD_MIN_LENGTH,
  masterPasswordIssue,
  masterPasswordLength,
  type MasterPasswordIssue,
} from "../../../src/core/master-password.js";
import type { MessageKey } from "../../../src/i18n/index.js";
import { passwordEntropy } from "../../lib/health.js";
import { masterPasswordMessage } from "../../lib/master-password.js";
import { useT } from "../i18n.js";

export interface MasterPasswordInputProps {
  name: string;
  email: string;
  issue: MasterPasswordIssue | null;
  onEdit: () => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  required?: boolean;
}

export function MasterPasswordInput({
  name,
  email,
  issue,
  onEdit,
  placeholder,
  ariaLabel,
  autoFocus,
  required = true,
}: MasterPasswordInputProps) {
  const t = useT();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const live = value ? masterPasswordIssue(value, email) : null;
  const shown = issue ?? (touched ? live : null);
  const strength = live ? "very_weak" : rateStrength(passwordEntropy(value));
  const fill = !value
    ? 0
    : live?.code === "too_short"
      ? masterPasswordLength(value) / MASTER_PASSWORD_MIN_LENGTH
      : 1;
  const message = shown ? masterPasswordMessage(shown) : null;
  const issueId = `${name}-issue`;

  return (
    <>
      <input
        name={name}
        type="password"
        autoComplete="new-password"
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? issueId : undefined}
        required={required}
        autoFocus={autoFocus}
        onInput={(event) => {
          setValue(event.currentTarget.value);
          onEdit();
        }}
        onBlur={() => setTouched(value !== "")}
      />
      <span
        className="pw-meter"
        data-strength={shown ? "invalid" : value ? strength : undefined}
        title={
          value
            ? t("password.strength", { strength: t(`strength.${strength}` as MessageKey) })
            : undefined
        }
        aria-hidden="true"
      >
        <span style={{ width: `${Math.round(fill * 100)}%` }} />
      </span>
      {message && (
        <span id={issueId} className="pw-issue" role="alert">
          {t(message.key, message.params)}
        </span>
      )}
    </>
  );
}
