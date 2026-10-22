import { downloadRecoveryKit } from "#ext/lib/account-recovery.js";
import { backupCodesText } from "#ext/lib/two-factor.js";
import { useT } from "../i18n.js";

export interface BackupCodesViewProps {
  codes: string[];
  email: string;
  server: string;
  createdAt: number;
  onCopied: () => void;
  onDone: () => void;
}

export function BackupCodesView(props: BackupCodesViewProps) {
  const t = useT();
  const copy = async () => {
    await navigator.clipboard.writeText(props.codes.join("\n"));
    props.onCopied();
  };
  return (
    <div className="recovery-reveal backup-codes stack">
      <p className="notice">{t("twofa.codes_save")}</p>
      <ol className="backup-code-list" id="backup-codes">
        {props.codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => void copy()}>
          {t("common.copy")}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => downloadRecoveryKit(backupCodesText(props), "7key-backup-codes.txt")}
        >
          {t("recovery.download")}
        </button>
      </div>
      <button
        type="button"
        className="button primary"
        id="backup-codes-done"
        onClick={props.onDone}
      >
        {t("twofa.codes_saved")}
      </button>
    </div>
  );
}
