import { useState } from "preact/hooks";
import { isVariable, type SecretAccess, type SecretKind } from "../../../src/core/projects.js";
import type { Secret } from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { Badge, When } from "../components.js";
import { toast, useConsole } from "../data.js";
import { KindPicker } from "./project-dialogs.js";

function copy(value: string, done: string) {
  void navigator.clipboard.writeText(value).then(() => toast(done));
}

function SecretRow({
  secret,
  editable,
  busy,
  onSave,
  onDelete,
  onAccess,
  onHosts,
}: {
  secret: Secret;
  editable: boolean;
  busy: boolean;
  onSave: (value: string, kind: SecretKind) => Promise<boolean>;
  onDelete: () => void;
  onAccess: (access: SecretAccess) => void;
  onHosts: () => void;
}) {
  const t = useT();
  const { emailOf } = useConsole();
  const variable = isVariable(secret);
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [kind, setKind] = useState<SecretKind>(secret.kind ?? "secret");

  return (
    <tr
      className={draft !== null ? "editing" : busy ? "pending-row" : ""}
      aria-busy={busy || undefined}
    >
      <td className="secret-name">
        <code>{secret.name}</code>
        {variable && <Badge>{t("console.kind_variable")}</Badge>}
        {!variable && (secret.hosts?.length ?? 0) > 0 && (
          <button
            type="button"
            className="agent-hosts"
            title={t("console.agent_hosts")}
            disabled={!editable}
            onClick={onHosts}
          >
            <Icon name="terminal" />
            {secret.hosts!.join(", ")}
          </button>
        )}
        {!variable && !secret.hosts?.length && editable && (
          <button type="button" className="agent-hosts empty" onClick={onHosts}>
            <Icon name="plus" />
            {t("console.agent_hosts_add")}
          </button>
        )}
      </td>
      <td className="secret-value">
        {draft !== null ? (
          <form
            className="inline-edit"
            onSubmit={(event) => {
              event.preventDefault();
              const value = draft;
              setDraft(null);
              void onSave(value, kind).then((saved) => {
                if (!saved) setDraft(value);
              });
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
              <KindPicker value={kind} onChange={setKind} />
              <button type="submit" className="btn primary sm">
                {t("projects.save")}
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>
                {t("pin.cancel")}
              </button>
            </div>
          </form>
        ) : variable ? (
          <span className="value-plain">
            {secret.value || <span className="muted">{t("console.empty_value")}</span>}
          </span>
        ) : (
          <button
            type="button"
            className={shown ? "value-toggle shown" : "value-toggle"}
            title={t(shown ? "projects.hide" : "projects.reveal")}
            onClick={() => {
              if (!shown) onAccess("revealed");
              setShown(!shown);
            }}
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
        <div className="row-actions-inner">
          <IconButton
            icon="copy"
            label={t("projects.copy")}
            onClick={() => {
              if (!variable) onAccess("copied");
              copy(secret.value, t("console.copied_name", { name: secret.name }));
            }}
          />
          {editable && (
            <>
              <IconButton
                icon="pencil"
                label={t("projects.edit")}
                onClick={() => {
                  if (!variable) onAccess("revealed");
                  setKind(secret.kind ?? "secret");
                  setDraft(secret.value);
                }}
              />
              <IconButton
                icon="trash"
                className="danger"
                label={t("projects.delete_secret")}
                onClick={onDelete}
              />
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function SecretsTable({
  secrets,
  query,
  editable,
  busyIds,
  onSave,
  onDelete,
  onAccess,
  onHosts,
}: {
  secrets: Secret[];
  query: string;
  editable: boolean;
  busyIds: ReadonlySet<string>;
  onSave: (secret: Secret, value: string, kind: SecretKind) => Promise<boolean>;
  onDelete: (secret: Secret) => void;
  onAccess: (access: SecretAccess, secretId: string) => void;
  onHosts: (secret: Secret) => void;
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
              busy={busyIds.has(secret.id)}
              onSave={(value, kind) => onSave(secret, value, kind)}
              onDelete={() => onDelete(secret)}
              onAccess={(access) => onAccess(access, secret.id)}
              onHosts={() => onHosts(secret)}
            />
          ))}
        </tbody>
      </table>
      {visible.length === 0 && (
        <p className="table-empty">
          <Icon name="search" />
          {t("console.no_match")}
        </p>
      )}
    </>
  );
}
