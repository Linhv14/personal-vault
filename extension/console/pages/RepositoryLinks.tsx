import { useEffect, useState } from "preact/hooks";
import { formText } from "../../../src/ui/form-data.js";
import { ACTION_MAJOR, ACTION_REPOSITORY, DEFAULT_SERVER } from "../../../src/core/brand.js";
import { isBranch, isGithubEnvironment, isRepository } from "../../../src/core/ci.js";
import { describeError } from "../../../src/i18n/index.js";
import {
  createLink,
  deleteLink,
  listLinks,
  type Project,
  type RepoLink,
} from "../../lib/projects.js";
import { getLocal } from "../../lib/storage.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, EmptyState, Field, When } from "../components.js";
import { toast, useConsole } from "../data.js";

type Rule = "branch" | "environment";

interface Created {
  repository: string;
  reference: string;
  repoKey: string;
}

function copy(value: string, done: string) {
  void navigator.clipboard.writeText(value).then(() => toast(done));
}

function workflow(reference: string, server: string): string {
  return [
    "permissions:",
    "  id-token: write",
    "  contents: read",
    "",
    "steps:",
    `  - uses: ${ACTION_REPOSITORY}@${ACTION_MAJOR}`,
    "    with:",
    `      link: ${reference}`,
    "      key: ${{ secrets.SEVENKEY_KEY }}",
    ...(server === DEFAULT_SERVER ? [] : [`      server: ${server}`]),
  ].join("\n");
}

function CreatedDialog({ created, onClose }: { created: Created; onClose: () => void }) {
  const t = useT();
  const [server, setServer] = useState(
    location.origin.startsWith("chrome-extension") ? DEFAULT_SERVER : location.origin,
  );
  useEffect(() => {
    if (!location.origin.startsWith("chrome-extension")) {
      return;
    }
    void getLocal().then(({ apiUrl }) => apiUrl && setServer(apiUrl.replace(/\/$/, "")));
  }, []);
  const snippet = workflow(created.reference, server);
  return (
    <Dialog
      title={t("ci.created_title", { repository: created.repository })}
      submitLabel={t("console.done")}
      onClose={onClose}
      onSubmit={onClose}
    >
      <Field label="SEVENKEY_KEY" hint={t("ci.key_hint")}>
        <div className="copy-field">
          <code>{created.repoKey}</code>
          <IconButton
            icon="copy"
            label={t("projects.copy")}
            onClick={() => copy(created.repoKey, t("projects.copied"))}
          />
        </div>
      </Field>
      <Field label={t("ci.workflow")}>
        <div className="copy-field block">
          <pre>{snippet}</pre>
          <IconButton
            icon="copy"
            label={t("projects.copy")}
            onClick={() => copy(snippet, t("projects.copied"))}
          />
        </div>
      </Field>
    </Dialog>
  );
}

function NewLinkDialog({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated: (created: Created) => void;
}) {
  const t = useT();
  const { detail, run } = useConsole();
  const [rule, setRule] = useState<Rule>("branch");
  const [error, setError] = useState<string | null>(null);
  const environments = project.content.environments;

  return (
    <Dialog
      title={t("ci.link_title")}
      submitLabel={t("ci.link")}
      onClose={onClose}
      onSubmit={(form) => {
        const data = new FormData(form);
        const repository = formText(data, "repository").trim();
        const value = formText(data, "rule").trim();
        if (!isRepository(repository)) {
          return setError(t("ci.invalid_repository"));
        }
        if (rule === "branch" ? !isBranch(value) : !isGithubEnvironment(value)) {
          return setError(t("ci.invalid_rule"));
        }
        void run(async () => {
          const created = await createLink(detail.org.id, project, {
            environmentId: formText(data, "environment"),
            repository,
            branch: rule === "branch" ? value : null,
            githubEnvironment: rule === "environment" ? value : null,
          });
          onCreated({ repository, ...created });
        }, "ci.linked");
      }}
    >
      <Field label={t("ci.repository")}>
        <input
          name="repository"
          className="mono"
          placeholder="owner/repo"
          required
          autoFocus
          autoComplete="off"
          spellcheck={false}
          onInput={() => setError(null)}
        />
      </Field>
      <Field label={t("console.environment")}>
        <select name="environment" defaultValue={environments.at(-1)?.id}>
          {environments.map((env) => (
            <option value={env.id} key={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("ci.allowed")}>
        <div className="segmented" role="radiogroup">
          {(["branch", "environment"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={rule === entry}
              aria-selected={rule === entry}
              onClick={() => setRule(entry)}
            >
              {t(entry === "branch" ? "ci.rule_branch" : "ci.rule_environment")}
            </button>
          ))}
        </div>
        <input
          name="rule"
          className="mono"
          key={rule}
          defaultValue={rule === "branch" ? "main" : "production"}
          required
          autoComplete="off"
          spellcheck={false}
          onInput={() => setError(null)}
        />
      </Field>
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}

export function RepositoryLinks({ project, canManage }: { project: Project; canManage: boolean }) {
  const t = useT();
  const { detail, emailOf, run } = useConsole();
  const [links, setLinks] = useState<RepoLink[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [removing, setRemoving] = useState<RepoLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orgId = detail.org.id;
  const envName = (id: string) =>
    project.content.environments.find((env) => env.id === id)?.name ?? "—";

  const load = async () => {
    try {
      setLinks(await listLinks(orgId, project));
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, [project.id, project.generation]);

  return (
    <>
      <div className="toolbar">
        <p className="toolbar-text">{t("ci.intro")}</p>
        {canManage && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="link" />
            {t("ci.link_title")}
          </button>
        )}
      </div>
      {error && <p className="alert">{error}</p>}
      {links?.length === 0 ? (
        <EmptyState icon="terminal" title={t("ci.none_title")} text={t("ci.none_text")} />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("ci.repository")}</th>
              <th>{t("console.environment")}</th>
              <th>{t("ci.allowed")}</th>
              <th>{t("ci.last_used")}</th>
              <th aria-label={t("console.actions")} />
            </tr>
          </thead>
          <tbody>
            {links?.map((link) => (
              <tr key={link.id}>
                <td>
                  <span
                    className="cell-title mono"
                    title={t("ci.created_by", { email: emailOf(link.createdBy) })}
                  >
                    {link.repository}
                  </span>
                </td>
                <td>{envName(link.environmentId)}</td>
                <td className="mono-sm">
                  {link.branch
                    ? `branch: ${link.branch}`
                    : `environment: ${link.githubEnvironment}`}
                </td>
                <td className="muted">
                  {link.lastUsedAt ? <When at={link.lastUsedAt} /> : t("ci.never")}
                </td>
                <td className="row-actions">
                  <div className="row-actions-inner">
                    {canManage && (
                      <IconButton
                        icon="trash"
                        className="danger"
                        label={t("ci.unlink")}
                        onClick={() => setRemoving(link)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <NewLinkDialog
          project={project}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            void load();
          }}
        />
      )}
      {created && <CreatedDialog created={created} onClose={() => setCreated(null)} />}
      {removing && (
        <Dialog
          title={t("ci.unlink")}
          description={t("ci.unlink_text", { repository: removing.repository })}
          highlight={[removing.repository]}
          submitLabel={t("ci.unlink")}
          danger
          onClose={() => setRemoving(null)}
          onSubmit={() =>
            void run(async () => {
              await deleteLink(orgId, project, removing.id);
              setRemoving(null);
              await load();
            }, "ci.unlinked")
          }
        />
      )}
    </>
  );
}
