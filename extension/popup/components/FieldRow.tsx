import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { IconName } from "../../../src/ui/icons.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { copy } from "../state.js";

export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div className="field">
      <span className="k">{label}</span>
      {children}
    </div>
  );
}

export function CopyRow({
  icon,
  label,
  onCopy,
  children,
  actions,
  multiline = false,
}: {
  icon?: IconName;
  label: string;
  onCopy: () => void;
  children: ComponentChildren;
  actions?: ComponentChildren;
  multiline?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={multiline ? "field-row multiline" : "field-row"}
      title={t("common.copy")}
      onClick={onCopy}
    >
      {icon ? <Icon name={icon} className="field-icon" /> : <span className="field-icon" />}
      <Field label={label}>{children}</Field>
      {actions}
      <IconButton icon="copy" className="field-copy" label={t("common.copy")} onClick={onCopy} />
    </div>
  );
}

export function ValueRow({
  icon,
  label,
  value,
  secret = false,
  multiline = false,
  masked = "•".repeat(Math.min(value.length, 12)),
}: {
  icon?: IconName;
  label: string;
  value: string;
  secret?: boolean;
  multiline?: boolean;
  masked?: string;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  return (
    <CopyRow
      icon={icon}
      label={label}
      multiline={multiline}
      onCopy={() => void copy(value, label.toLowerCase())}
      actions={
        secret && (
          <IconButton
            icon={revealed ? "eye-off" : "eye"}
            label={t(revealed ? "common.hide" : "common.show")}
            onClick={() => setRevealed(!revealed)}
          />
        )
      }
    >
      <span className={secret ? "v mono" : "v"}>{secret && !revealed ? masked : value}</span>
    </CopyRow>
  );
}
