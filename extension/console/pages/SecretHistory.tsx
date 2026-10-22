import { useEffect, useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import {
  listSecretVersions,
  type Project,
  type Secret,
  type SecretVersion,
} from "../../lib/projects.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, When } from "../components.js";
import { toast, useConsole } from "../data.js";

export function SecretHistoryDialog({
  orgId,
  project,
  secret,
  editable,
  onRevealed,
  onRestore,
  onClose,
}: {
  orgId: string;
  project: Project;
  secret: Secret;
  editable: boolean;
  onRevealed: () => void;
  onRestore: (version: SecretVersion) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { emailOf } = useConsole();
  const [versions, setVersions] = useState<SecretVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    listSecretVersions(orgId, project, secret).then(
      (list) => {
        const distinct = list.filter(
          (version, index) =>
            version.value !== (index === 0 ? secret.value : list[index - 1]!.value),
        );
        setVersions(distinct);
      },
      (failure: unknown) => setError(describeError(failure, t)),
    );
  }, [secret.id]);

  return (
    <Dialog
      title={t("console.history_title", { name: secret.name })}
      description={t("console.history_hint")}
      submitLabel={t("console.close")}
      hideCancel
      onClose={onClose}
      onSubmit={onClose}
    >
      {error && <p className="form-error">{error}</p>}
      {!error && versions === null && <p className="muted">{t("console.loading")}</p>}
      {versions?.length === 0 && <p className="muted">{t("console.history_empty")}</p>}
      {versions && versions.length > 0 && (
        <ul className="history-list">
          {versions.map((version) => (
            <li key={version.id}>
              <div className="history-meta">
                <When at={version.updatedAt} />
                <span className="muted">{emailOf(version.updatedBy)}</span>
              </div>
              <button
                type="button"
                className={shown === version.id ? "value-toggle shown" : "value-toggle"}
                onClick={() => {
                  if (shown !== version.id) {
                    onRevealed();
                  }
                  setShown(shown === version.id ? null : version.id);
                }}
              >
                {shown === version.id
                  ? version.value || <span className="muted">{t("console.empty_value")}</span>
                  : "••••••••••••"}
              </button>
              <div className="history-actions">
                <IconButton
                  icon="copy"
                  label={t("projects.copy")}
                  onClick={() => {
                    onRevealed();
                    void navigator.clipboard
                      .writeText(version.value)
                      .then(() => toast(t("console.copied_name", { name: secret.name })));
                  }}
                />
                {editable && (
                  <button type="button" className="btn sm" onClick={() => onRestore(version)}>
                    {t("console.history_restore")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
