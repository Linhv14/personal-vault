import { useEffect, useState } from "preact/hooks";
import {
  formatDotenv,
  MAX_ENVIRONMENTS,
  newEnvironment,
  parseDotenv,
} from "../../../src/core/projects.js";
import { describeError } from "../../../src/i18n/index.js";
import { isOrgAdmin } from "../../lib/orgs.js";
import {
  deleteProject,
  deleteSecret,
  importSecrets,
  listSecrets,
  saveSecret,
  updateProject,
  type Secret,
} from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import {
  Badge,
  Dialog,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  PageHeader,
  SearchInput,
} from "../components.js";
import { attempt, toast, useConsole } from "../data.js";
import { href, navigate } from "../router.js";
import {
  AddSecretDialog,
  ImportDialog,
  TypeToConfirmDialog,
  type SecretDraft,
} from "./project-dialogs.js";
import { SecretsTable } from "./SecretsTable.js";

type Modal =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "rename" }
  | { kind: "add-env" }
  | { kind: "rename-env" }
  | { kind: "delete-env" }
  | { kind: "delete-project" }
  | { kind: "delete-secret"; secret: Secret }
  | null;

export function ProjectPage({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string | null;
}) {
  const t = useT();
  const { detail, identity, projects, team, run, reload } = useConsole();
  const project = projects?.find((entry) => entry.id === projectId);
  const [secrets, setSecrets] = useState<Record<string, Secret[]> | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const orgId = detail.org.id;

  const load = async () => {
    if (!project) return;
    try {
      const lists = await Promise.all(
        project.content.environments.map(async (env) => [
          env.id,
          await listSecrets(orgId, project, env.id),
        ]),
      );
      setSecrets(Object.fromEntries(lists));
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, [project?.id, project?.generation, project?.content.environments.map((env) => env.id).join()]);

  if (!projects) return <span className="spinner" />;
  if (!project) {
    return (
      <EmptyState
        icon="braces"
        title={t("console.project_missing")}
        action={
          <a className="btn" href={href(orgId, { page: "projects" })}>
            {t("projects.back")}
          </a>
        }
      />
    );
  }

  const owner = team(project.teamId);
  const editable = Boolean(owner && !owner.rekeyNeeded);
  const canManage = isOrgAdmin(detail.org.role) && editable;
  const { environments } = project.content;
  const environment = environments.find((env) => env.id === environmentId) ?? null;
  const tab = (id: string | null) => href(orgId, { page: "project", projectId, environmentId: id });

  const mutate = async (work: () => Promise<unknown>, done: Parameters<typeof t>[0]) => {
    setError(null);
    const succeeded = await attempt(work, (failure) => describeError(failure, t));
    await Promise.all([load(), reload()]);
    if (succeeded) toast(t(done));
    return succeeded;
  };

  const addSecret = (draft: SecretDraft) =>
    void mutate(async () => {
      for (const [envId, value] of Object.entries(draft.values)) {
        const current = await listSecrets(orgId, project, envId);
        const same = current.find((secret) => secret.name === draft.name);
        await saveSecret(orgId, project, envId, { id: same?.id, name: draft.name, value });
      }
      setModal(null);
    }, "projects.saved");

  const importText = (envId: string, text: string) =>
    void mutate(async () => {
      const current = await listSecrets(orgId, project, envId);
      await importSecrets(orgId, project, envId, current, parseDotenv(text));
      setModal(null);
    }, "projects.imported");

  const all = secrets ? Object.values(secrets).flat() : [];
  const duplicates = Object.values(secrets ?? {}).flatMap((list) =>
    [...list]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((secret, index, sorted) => sorted.findIndex((x) => x.name === secret.name) !== index),
  );
  const removeDuplicates = () =>
    void mutate(async () => {
      for (const secret of duplicates) await deleteSecret(orgId, project, secret.id);
    }, "console.duplicates_removed");
  const names = [...new Set(all.map((secret) => secret.name))].sort();
  const missing = environments.map((env) => ({
    env,
    count: names.filter((name) => !secrets?.[env.id]?.some((secret) => secret.name === name))
      .length,
  }));

  const actions = (
    <>
      {editable && (
        <>
          <button type="button" className="btn" onClick={() => setModal({ kind: "import" })}>
            <Icon name="upload" />
            {t("projects.import")}
          </button>
          <button type="button" className="btn primary" onClick={() => setModal({ kind: "add" })}>
            <Icon name="plus" />
            {t("projects.add_secret")}
          </button>
        </>
      )}
      {canManage && (
        <Menu label={t("console.more")}>
          <MenuItem
            icon="pencil"
            label={t("console.rename")}
            onSelect={() => setModal({ kind: "rename" })}
          />
          {duplicates.length > 0 && (
            <MenuItem
              icon="trash"
              label={t("console.remove_duplicates", { count: duplicates.length })}
              onSelect={removeDuplicates}
            />
          )}
          <MenuItem
            icon="plus"
            label={t("console.add_environment")}
            onSelect={() => setModal({ kind: "add-env" })}
          />
          {environment && (
            <MenuItem
              icon="pencil"
              label={t("console.rename_environment", { env: environment.name })}
              onSelect={() => setModal({ kind: "rename-env" })}
            />
          )}
          {environment && environments.length > 1 && (
            <MenuItem
              icon="trash"
              label={t("console.delete_environment", { env: environment.name })}
              danger
              onSelect={() => setModal({ kind: "delete-env" })}
            />
          )}
          <MenuItem
            icon="trash"
            label={t("projects.delete")}
            danger
            onSelect={() => setModal({ kind: "delete-project" })}
          />
        </Menu>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("projects.tab"), href: href(orgId, { page: "projects" }) }]}
        title={project.content.name}
        meta={
          <>
            <a href={href(orgId, { page: "team", teamId: project.teamId })}>{owner?.name}</a>
            <span>·</span>
            <span>{t("console.secret_count", { count: names.length })}</span>
          </>
        }
        actions={actions}
      />

      {duplicates.length > 0 && editable && (
        <div className="alert warn action">
          <span>{t("console.duplicates_found", { count: duplicates.length })}</span>
          <button type="button" className="btn" onClick={removeDuplicates}>
            {t("console.remove_duplicates", { count: duplicates.length })}
          </button>
        </div>
      )}
      {!editable && (
        <p className="alert warn">
          {t("projects.rekey_first")}{" "}
          <a href={href(orgId, { page: "team", teamId: project.teamId })}>
            {t("console.open_team")}
          </a>
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <nav className="tabs" role="tablist">
        <a href={tab(null)} role="tab" aria-selected={!environment}>
          {t("console.overview")}
        </a>
        {environments.map((env) => {
          const gap = missing.find((entry) => entry.env.id === env.id)?.count ?? 0;
          return (
            <a
              href={tab(env.id)}
              role="tab"
              aria-selected={environment?.id === env.id}
              key={env.id}
            >
              {env.name}
              <span className="tab-count">{secrets?.[env.id]?.length ?? "–"}</span>
              {gap > 0 && (
                <span className="tab-dot" title={t("console.missing_count", { count: gap })} />
              )}
            </a>
          );
        })}
        {canManage && environments.length < MAX_ENVIRONMENTS && (
          <button type="button" className="tab-add" onClick={() => setModal({ kind: "add-env" })}>
            <Icon name="plus" />
            {t("console.environment")}
          </button>
        )}
      </nav>

      <section className="panel">
        <div className="toolbar">
          <SearchInput value={query} onInput={setQuery} placeholder={t("console.search_secrets")} />
          {environment && (
            <button
              type="button"
              className="btn ghost"
              disabled={!secrets?.[environment.id]?.length}
              onClick={() =>
                void navigator.clipboard
                  .writeText(formatDotenv(secrets?.[environment.id] ?? []))
                  .then(() => toast(t("projects.copied")))
              }
            >
              <Icon name="copy" />
              {t("projects.copy_env")}
            </button>
          )}
        </div>

        {!secrets ? (
          <span className="spinner" />
        ) : names.length === 0 ? (
          <EmptyState
            icon="key"
            title={t("console.no_secrets_title")}
            text={t("console.no_secrets_text")}
          />
        ) : environment ? (
          (secrets[environment.id]?.length ?? 0) === 0 ? (
            <p className="table-empty">{t("projects.empty_env", { env: environment.name })}</p>
          ) : (
            <SecretsTable
              secrets={secrets[environment.id] ?? []}
              query={query}
              editable={editable}
              onSave={(secret, value) =>
                mutate(
                  () =>
                    saveSecret(orgId, project, environment.id, {
                      id: secret.id,
                      name: secret.name,
                      value,
                    }),
                  "projects.saved",
                )
              }
              onDelete={(secret) => setModal({ kind: "delete-secret", secret })}
            />
          )
        ) : (
          <Matrix
            names={names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))}
            secrets={secrets}
            environments={environments}
            tab={tab}
          />
        )}
      </section>

      {modal?.kind === "add" && (
        <AddSecretDialog
          environments={environments}
          selected={environment ? [environment.id] : environments.map((env) => env.id)}
          existing={secrets ?? {}}
          onClose={() => setModal(null)}
          onSave={addSecret}
        />
      )}
      {modal?.kind === "import" && (
        <ImportDialog
          environments={environments}
          environmentId={environment?.id ?? environments[0]?.id ?? ""}
          existing={secrets ?? {}}
          onClose={() => setModal(null)}
          onImport={importText}
        />
      )}
      {modal?.kind === "add-env" && owner && (
        <Dialog
          title={t("console.add_environment")}
          description={t("console.add_environment_hint")}
          submitLabel={t("orgs.create")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const name = String(new FormData(form).get("name")).trim();
            const created = newEnvironment(name);
            void run(async () => {
              await updateProject(orgId, owner, identity, project, {
                ...project.content,
                environments: [...environments, created],
              });
              setModal(null);
              navigate(orgId, { page: "project", projectId, environmentId: created.id });
            }, "console.environment_added");
          }}
        >
          <Field label={t("console.environment_name")}>
            <input name="name" maxLength={40} required autoFocus placeholder="QA" />
          </Field>
        </Dialog>
      )}
      {modal?.kind === "rename-env" && owner && environment && (
        <Dialog
          title={t("console.rename_environment", { env: environment.name })}
          submitLabel={t("projects.save")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const name = String(new FormData(form).get("name")).trim();
            void run(async () => {
              await updateProject(orgId, owner, identity, project, {
                ...project.content,
                environments: environments.map((env) =>
                  env.id === environment.id ? { ...env, name } : env,
                ),
              });
              setModal(null);
            }, "console.renamed");
          }}
        >
          <Field label={t("console.environment_name")}>
            <input name="name" defaultValue={environment.name} maxLength={40} required autoFocus />
          </Field>
        </Dialog>
      )}
      {modal?.kind === "delete-env" && owner && environment && (
        <TypeToConfirmDialog
          title={t("console.delete_environment", { env: environment.name })}
          text={t("console.delete_environment_text", {
            count: secrets?.[environment.id]?.length ?? 0,
          })}
          phrase={environment.name}
          submitLabel={t("projects.delete_secret")}
          onClose={() => setModal(null)}
          onConfirm={() =>
            void run(async () => {
              for (const secret of secrets?.[environment.id] ?? []) {
                await deleteSecret(orgId, project, secret.id);
              }
              await updateProject(orgId, owner, identity, project, {
                ...project.content,
                environments: environments.filter((env) => env.id !== environment.id),
              });
              setModal(null);
              navigate(orgId, { page: "project", projectId, environmentId: null });
            }, "console.environment_deleted")
          }
        />
      )}
      {modal?.kind === "rename" && owner && (
        <Dialog
          title={t("console.rename")}
          submitLabel={t("projects.save")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const name = String(new FormData(form).get("name")).trim();
            void run(async () => {
              await updateProject(orgId, owner, identity, project, { ...project.content, name });
              setModal(null);
            }, "console.renamed");
          }}
        >
          <Field label={t("projects.name")}>
            <input
              name="name"
              defaultValue={project.content.name}
              maxLength={80}
              required
              autoFocus
            />
          </Field>
        </Dialog>
      )}
      {modal?.kind === "delete-project" && (
        <TypeToConfirmDialog
          title={t("projects.delete")}
          text={t("console.delete_project_text", { count: names.length })}
          phrase={project.content.name}
          submitLabel={t("projects.delete")}
          onClose={() => setModal(null)}
          onConfirm={() =>
            void run(async () => {
              await deleteProject(orgId, project);
              setModal(null);
              navigate(orgId, { page: "projects" });
            }, "projects.deleted")
          }
        />
      )}
      {modal?.kind === "delete-secret" && (
        <Dialog
          title={t("console.delete_secret_title")}
          description={t("projects.delete_secret_confirm", {
            name: modal.secret.name,
            env: environment?.name ?? "",
          })}
          submitLabel={t("projects.delete_secret")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void mutate(async () => {
              await deleteSecret(orgId, project, modal.secret.id);
              setModal(null);
            }, "projects.secret_deleted")
          }
        />
      )}
    </>
  );
}

function Matrix({
  names,
  secrets,
  environments,
  tab,
}: {
  names: string[];
  secrets: Record<string, Secret[]>;
  environments: { id: string; name: string }[];
  tab: (id: string | null) => string;
}) {
  const t = useT();
  const incomplete = names.filter((name) =>
    environments.some((env) => !secrets[env.id]?.some((secret) => secret.name === name)),
  ).length;
  return (
    <>
      <p className="matrix-summary">
        {incomplete === 0 ? (
          <Badge tone="ok">
            <Icon name="check" /> {t("console.all_present")}
          </Badge>
        ) : (
          <Badge tone="warn">
            <Icon name="alert" /> {t("console.incomplete", { count: incomplete })}
          </Badge>
        )}
      </p>
      <table className="table matrix">
        <thead>
          <tr>
            <th>{t("console.secret_name")}</th>
            {environments.map((env) => (
              <th key={env.id} className="center">
                <a href={tab(env.id)}>{env.name}</a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <td className="secret-name">
                <code>{name}</code>
              </td>
              {environments.map((env) => {
                const secret = secrets[env.id]?.find((entry) => entry.name === name);
                return (
                  <td key={env.id} className="center">
                    {secret ? (
                      secret.value === "" ? (
                        <Badge>{t("console.empty_value")}</Badge>
                      ) : (
                        <span className="cell-set" title={t("console.set")}>
                          <Icon name="check" />
                        </span>
                      )
                    ) : (
                      <a
                        href={tab(env.id)}
                        className="cell-missing"
                        title={t("console.missing")}
                        aria-label={t("console.missing")}
                      >
                        —
                      </a>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {names.length === 0 && <p className="table-empty">{t("console.no_match")}</p>}
    </>
  );
}
