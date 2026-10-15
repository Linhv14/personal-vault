import { useEffect, useState } from "preact/hooks";
import { formatDotenv, isSecretName, parseDotenv } from "../../../../src/core/projects.js";
import { describeError } from "../../../../src/i18n/index.js";
import { isOrgAdmin, type Team } from "../../../lib/orgs.js";
import {
  deleteProject,
  deleteSecret,
  importSecrets,
  listSecrets,
  saveSecret,
  type Project,
  type Secret,
} from "../../../lib/projects.js";
import { Button } from "../../../ui/components/Button.js";
import { Card } from "../../../ui/components/Card.js";
import { Icon } from "../../../ui/components/Icon.js";
import { IconButton } from "../../../ui/components/IconButton.js";
import { formatDateTime } from "../../../ui/format.js";
import { localeSignal, useT } from "../../../ui/i18n.js";
import { showToast } from "../../state.js";
import { useOrg } from "../context.js";

type Panel = "add" | "import" | null;

function SecretForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Secret;
  onSave: (name: string, value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useT();
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="secret-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const name = String(data.get("name")).trim();
        if (!isSecretName(name)) {
          setInvalid(true);
          return;
        }
        void onSave(name, String(data.get("value")));
      }}
    >
      <input
        name="name"
        className="mono"
        defaultValue={initial?.name}
        placeholder={t("projects.secret_name")}
        aria-label={t("projects.secret_name")}
        autoComplete="off"
        spellcheck={false}
        required
        autoFocus={!initial}
        onInput={() => setInvalid(false)}
      />
      <textarea
        name="value"
        className="mono"
        rows={1}
        defaultValue={initial?.value}
        placeholder={t("projects.secret_value")}
        aria-label={t("projects.secret_value")}
        autoComplete="off"
        spellcheck={false}
        autoFocus={Boolean(initial)}
      />
      <div className="secret-form-actions">
        <Button variant="primary" type="submit">
          {t("projects.save")}
        </Button>
        <Button className="quiet" type="button" onClick={onCancel}>
          {t("pin.cancel")}
        </Button>
      </div>
      {invalid && <p className="error">{t("projects.invalid_name")}</p>}
    </form>
  );
}

function SecretRow({
  secret,
  editable,
  onSave,
  onDelete,
}: {
  secret: Secret;
  editable: boolean;
  onSave: (name: string, value: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useT();
  const { emailOf } = useOrg();
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="secret editing">
        <SecretForm
          initial={secret}
          onSave={async (name, value) => {
            if (await onSave(name, value)) setEditing(false);
            return true;
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="secret">
      <span className="secret-text">
        <code className="secret-name">{secret.name}</code>
        <code className={shown ? "secret-value" : "secret-value masked"}>
          {shown ? secret.value || "—" : "••••••••••••"}
        </code>
        <small>
          {emailOf(secret.updatedBy)} · {formatDateTime(secret.updatedAt, localeSignal.value)}
        </small>
      </span>
      <span className="secret-actions">
        <IconButton
          icon={shown ? "eye-off" : "eye"}
          label={t(shown ? "projects.hide" : "projects.reveal")}
          onClick={() => setShown(!shown)}
        />
        <IconButton
          icon="copy"
          label={t("projects.copy")}
          onClick={() =>
            void navigator.clipboard
              .writeText(secret.value)
              .then(() => showToast(t("projects.copied")))
          }
        />
        {editable && (
          <>
            <IconButton icon="pencil" label={t("projects.edit")} onClick={() => setEditing(true)} />
            <IconButton icon="trash" label={t("projects.delete_secret")} onClick={onDelete} />
          </>
        )}
      </span>
    </li>
  );
}

export function ProjectView({
  project,
  team,
  onBack,
  onChanged,
}: {
  project: Project;
  team: Team;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { detail, run } = useOrg();
  const { environments } = project.content;
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const environment = environments.find((entry) => entry.id === environmentId);
  const editable = !team.rekeyNeeded;

  const load = async () => {
    setError(null);
    try {
      setSecrets(await listSecrets(detail.org.id, project, environmentId));
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    setSecrets(null);
    setPanel(null);
    void load();
  }, [project.id, project.generation, environmentId]);

  const mutate = async (
    work: () => Promise<unknown>,
    done: Parameters<typeof t>[0],
  ): Promise<boolean> => {
    setError(null);
    try {
      await work();
      showToast(t(done));
      await load();
      return true;
    } catch (failure) {
      setError(describeError(failure, t));
      return false;
    }
  };

  const save = (id: string | undefined) => async (name: string, value: string) => {
    const clash = secrets?.find((secret) => secret.name === name && secret.id !== id);
    if (clash && id !== undefined) {
      setError(t("projects.name_taken", { name }));
      return false;
    }
    return mutate(async () => {
      await saveSecret(detail.org.id, project, environmentId, { id: id ?? clash?.id, name, value });
      if (id === undefined) setPanel(null);
    }, "projects.saved");
  };

  const remove = (secret: Secret) => {
    if (
      !confirm(
        t("projects.delete_secret_confirm", { name: secret.name, env: environment?.name ?? "" }),
      )
    ) {
      return;
    }
    void mutate(() => deleteSecret(detail.org.id, project, secret.id), "projects.secret_deleted");
  };

  const importText = (text: string) => {
    const entries = parseDotenv(text);
    void mutate(async () => {
      await importSecrets(detail.org.id, project, environmentId, secrets ?? [], entries);
      setPanel(null);
    }, "projects.imported");
  };

  const removeProject = () => {
    if (!confirm(t("projects.delete_confirm", { name: project.content.name }))) return;
    void run(async () => {
      await deleteProject(detail.org.id, project);
      onBack();
      onChanged();
    }, "projects.deleted");
  };

  const copyAll = () =>
    void navigator.clipboard
      .writeText(formatDotenv(secrets ?? []))
      .then(() => showToast(t("projects.copied")));

  const canManage = isOrgAdmin(detail.org.role);

  return (
    <Card className="project">
      <div className="project-head">
        <button type="button" className="back-link" onClick={onBack}>
          <Icon name="back" />
          {t("projects.back")}
        </button>
        <h2>{project.content.name}</h2>
        <p className="row-hint">{team.name}</p>
      </div>

      <nav className="env-tabs" role="tablist" aria-label={t("projects.environments")}>
        {environments.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === environmentId}
            className={entry.id === environmentId ? "env-tab active" : "env-tab"}
            onClick={() => setEnvironmentId(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </nav>

      {!editable && <p className="rekey-note">{t("projects.rekey_first")}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="secret-toolbar">
        {editable && (
          <>
            <Button variant="primary" onClick={() => setPanel(panel === "add" ? null : "add")}>
              {t("projects.add_secret")}
            </Button>
            <Button onClick={() => setPanel(panel === "import" ? null : "import")}>
              {t("projects.import")}
            </Button>
          </>
        )}
        <Button className="quiet" onClick={copyAll} disabled={!secrets?.length}>
          {t("projects.copy_env")}
        </Button>
      </div>

      {panel === "add" && <SecretForm onSave={save(undefined)} onCancel={() => setPanel(null)} />}
      {panel === "import" && (
        <form
          className="import-form"
          onSubmit={(event) => {
            event.preventDefault();
            importText(String(new FormData(event.currentTarget).get("dotenv")));
          }}
        >
          <textarea
            name="dotenv"
            className="mono"
            rows={6}
            placeholder={"API_URL=https://api.example.com\nAPI_KEY=…"}
            aria-label={t("projects.import")}
            spellcheck={false}
            required
            autoFocus
          />
          <p className="row-hint">{t("projects.import_hint")}</p>
          <div className="secret-form-actions">
            <Button variant="primary" type="submit">
              {t("projects.import")}
            </Button>
            <Button className="quiet" type="button" onClick={() => setPanel(null)}>
              {t("pin.cancel")}
            </Button>
          </div>
        </form>
      )}

      {secrets && secrets.length === 0 && panel === null && (
        <p className="empty">{t("projects.empty_env", { env: environment?.name ?? "" })}</p>
      )}
      <ul className="secrets">
        {secrets?.map((secret) => (
          <SecretRow
            key={secret.id}
            secret={secret}
            editable={editable}
            onSave={save(secret.id)}
            onDelete={() => remove(secret)}
          />
        ))}
      </ul>

      {canManage && (
        <div className="team-foot">
          <Button className="quiet danger-quiet" onClick={removeProject}>
            {t("projects.delete")}
          </Button>
        </div>
      )}
    </Card>
  );
}
