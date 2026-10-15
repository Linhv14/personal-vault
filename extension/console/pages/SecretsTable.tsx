import { useState } from "preact/hooks";
import type { Secret } from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { When } from "../components.js";
import { toast, useConsole } from "../data.js";

function copy(value: string, done: string) {
  void navigator.clipboard.writeText(value).then(() => toast(done));
}

function SecretRow({
  secret,
  editable,
  onSave,
  onDelete,
}: {
  secret: Secret;
  editable: boolean;
  onSave: (value: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useT();
  const { emailOf } = useConsole();
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <tr className={draft !== null ? "editing" : ""}>
      <td className="secret-name">
        <code>{secret.name}</code>
      </td>
      <td className="secret-value">
        {draft !== null ? (
          <form
            className="inline-edit"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave(draft).then((saved) => saved && setDraft(null));
            }}
          >
            <textarea
              className="mono"
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              value={draft}
              autoFocus
              spellcheck={false}
              aria-label={secret.name}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDraft(null);
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="inline-edit-actions">
              <button type="submit" className="btn primary sm">
                {t("projects.save")}
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>
                {t("pin.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={shown ? "value-toggle shown" : "value-toggle"}
            title={t(shown ? "projects.hide" : "projects.reveal")}
            onClick={() => setShown(!shown)}
          >
            {shown
              ? secret.value || <span className="muted">{t("console.empty_value")}</span>
              : "••••••••••••"}
          </button>
        )}
      </td>
      <td className="muted nowrap" title={emailOf(secret.updatedBy)}>
        <When at={secret.updatedAt} />
      </td>
      <td className="row-actions">
        <IconButton
          icon="copy"
          label={t("projects.copy")}
          onClick={() => copy(secret.value, t("console.copied_name", { name: secret.name }))}
        />
        {editable && (
          <>
            <IconButton
              icon="pencil"
              label={t("projects.edit")}
              onClick={() => setDraft(secret.value)}
            />
            <IconButton icon="trash" label={t("projects.delete_secret")} onClick={onDelete} />
          </>
        )}
      </td>
    </tr>
  );
}

export function SecretsTable({
  secrets,
  query,
  editable,
  onSave,
  onDelete,
}: {
  secrets: Secret[];
  query: string;
  editable: boolean;
  onSave: (secret: Secret, value: string) => Promise<boolean>;
  onDelete: (secret: Secret) => void;
}) {
  const t = useT();
  const needle = query.trim().toLowerCase();
  const visible = secrets.filter((secret) => secret.name.toLowerCase().includes(needle));
  if (secrets.length === 0) return null;
  return (
    <>
      <table className="table secrets-table">
        <thead>
          <tr>
            <th>{t("console.secret_name")}</th>
            <th>{t("projects.secret_value")}</th>
            <th>{t("console.last_change")}</th>
            <th aria-label={t("console.actions")} />
          </tr>
        </thead>
        <tbody>
          {visible.map((secret) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              editable={editable}
              onSave={(value) => onSave(secret, value)}
              onDelete={() => onDelete(secret)}
            />
          ))}
        </tbody>
      </table>
      {visible.length === 0 && (
        <p className="table-empty">
          <Icon name="search" /> {t("console.no_match")}
        </p>
      )}
    </>
  );
}
