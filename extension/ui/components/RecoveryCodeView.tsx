import { downloadRecoveryKit, recoveryKitText } from "../../lib/account-recovery.js";
import { useT } from "../i18n.js";

export interface RecoveryCodeViewProps {
  code: string;
  email: string;
  server: string;
  createdAt: number;
  doneLabel: string;
  onCopied: () => void;
  onDone: () => void;
}

export function RecoveryCodeView(props: RecoveryCodeViewProps) {
  const t = useT();
  const copy = async () => {
    await navigator.clipboard.writeText(props.code);
    props.onCopied();
  };
  return (
    <div className="recovery-reveal stack">
      <p className="notice">{t("recovery.save_now")}</p>
      <code className="recovery-code" id="recovery-code">
        {props.code}
      </code>
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => void copy()}>
          {t("common.copy")}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => downloadRecoveryKit(recoveryKitText(props))}
        >
          {t("recovery.download")}
        </button>
      </div>
      <button type="button" className="button primary" id="recovery-done" onClick={props.onDone}>
        {props.doneLabel}
      </button>
    </div>
  );
}
