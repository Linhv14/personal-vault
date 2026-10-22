import { useState } from "preact/hooks";
import {
  formatDotenv,
  isVariable,
  parseDotenv,
  type SecretKind,
} from "../../../src/core/projects.js";
import { isOrgAdmin } from "../../lib/orgs.js";
import {
  deleteSecret,
  importSecrets,
  listSecrets,
  noteAccess,
  saveSecret,
  saveSecrets,
  type Project,
} from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { EmptyState, PageHeader, PageSkeleton, SearchInput, SkeletonTable } from "../components.js";
import { pending$, toast, useConsole } from "../data.js";
import { href } from "../router.js";
import { AddSecretDialog, ImportDialog, type SecretDraft } from "./project-dialogs.js";
import { EnvironmentTabs } from "./project/EnvironmentTabs.js";
import {
  CI_TAB,
  matchingNames,
  missingCounts,
  secretNames,
  withHosts,
  type Modal,
} from "./project/helpers.js";
import { Matrix } from "./project/Matrix.js";
import { ProjectActions } from "./project/ProjectActions.js";
import {
  AddEnvironmentDialog,
  DeleteEnvironmentDialog,
  DeleteProjectDialog,
  DeleteSecretDialog,
  RemoveDuplicatesDialog,
  RenameEnvironmentDialog,
  RenameProjectDialog,
} from "./project/ProjectDialogs.js";
import { useDuplicates } from "./project/useDuplicates.js";
import { useHostSuggestions } from "./project/useHostSuggestions.js";
import { useProjectSecrets } from "./project/useProjectSecrets.js";
import { RepositoryLinks } from "./RepositoryLinks.js";
import { SecretHistoryDialog } from "./SecretHistory.js";
import { SecretsTable } from "./SecretsTable.js";

type SecretsState = ReturnType<typeof useProjectSecrets>;

export function ProjectPage({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string | null;
}) {
  const t = useT();
  const { detail, projects, team, reload, refreshing } = useConsole();
  const project = projects?.find((entry) => entry.id === projectId);
  const orgId = detail.org.id;
  const state = useProjectSecrets({ orgId, project, team, reload });
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);

  if (!projects || (!project && (refreshing || pending$.value))) {
    return <PageSkeleton />;
  }
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
  return (
    <ProjectView
      project={project}
      environmentId={environmentId}
      state={state}
      query={query}
      setQuery={setQuery}
      modal={modal}
      setModal={setModal}
    />
  );
}

function ProjectView({
  project,
  environmentId,
  state,
  query,
  setQuery,
  modal,
  setModal,
}: {
  project: Project;
  environmentId: string | null;
  state: SecretsState;
  query: string;
  setQuery: (query: string) => void;
  modal: Modal;
  setModal: (modal: Modal) => void;
}) {
  const t = useT();
  const { detail, team, me } = useConsole();
  const { secrets, setSecrets, error, busyIds, mutate } = state;
  const orgId = detail.org.id;
  const projectId = project.id;

  const owner = team(project.teamId);
  const unlocked = Boolean(owner && !owner.rekeyNeeded);
  const admin = isOrgAdmin(detail.org.role);
  const viewer = !admin && Boolean(me && owner?.viewers.includes(me.accountId));
  const editable = unlocked && !viewer;
  const guarded = (envId: string) => project.protectedEnvironments.includes(envId);
  const writable = (envId: string) => editable && (admin || !guarded(envId));
  const canManage = isOrgAdmin(detail.org.role) && unlocked;
  const { environments } = project.content;
  const writableEnvironments = environments.filter((env) => writable(env.id));
  const environment = environments.find((env) => env.id === environmentId) ?? null;
  const ciTab = environmentId === CI_TAB;
  const tab = (id: string | null) => href(orgId, { page: "project", projectId, environmentId: id });

  const addSecret = (draft: SecretDraft) =>
    void mutate(async () => {
      const writes = await Promise.all(
        Object.entries(draft.values).map(async ([envId, value]) => {
          const current = await listSecrets(orgId, project, envId);
          const same = current.find((secret) => secret.name === draft.name);
          return {
            id: same?.id,
            environmentId: envId,
            name: draft.name,
            value,
            kind: draft.kind,
            hosts: draft.hosts,
          };
        }),
      );
      await saveSecrets(orgId, project, writes);
      setModal(null);
    }, "projects.saved");

  const importText = (envId: string, text: string, kind: SecretKind) =>
    void mutate(async () => {
      const current = await listSecrets(orgId, project, envId);
      const entries = parseDotenv(text).map((entry) => ({ ...entry, kind }));
      await importSecrets(orgId, project, envId, current, entries);
      setModal(null);
    }, "projects.imported");

  const all = secrets ? Object.values(secrets).flat() : [];
  const { duplicates, removeDuplicates } = useDuplicates({
    orgId,
    project,
    secrets,
    writable,
    mutate,
  });
  const { suggestedNames, applySuggestions } = useHostSuggestions({
    orgId,
    project,
    all,
    writable,
    mutate,
  });
  const names = secretNames(all);
  const missing = missingCounts(environments, names, secrets);
  const close = () => setModal(null);

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("projects.tab"), href: href(orgId, { page: "projects" }) }]}
        title={project.content.name}
        meta={
          <>
            <a href={href(orgId, { page: "team", teamId: project.teamId })}>{owner?.name}</a>
            <span>·</span>
            <span>
              {t("console.secret_count", { count: secrets ? all.length : project.secretCount })}
            </span>
            {viewer && (
              <span className="lock-pill" title={t("console.access_view_tip")}>
                <Icon name="eye" />
                {t("console.access_view")}
              </span>
            )}
          </>
        }
        actions={
          <ProjectActions
            orgId={orgId}
            project={project}
            environment={environment}
            canAdd={writableEnvironments.length > 0}
            canManage={canManage}
            guarded={guarded}
            duplicateCount={duplicates.length}
            open={setModal}
          />
        }
      />

      {suggestedNames.length > 0 && editable && (
        <div className="alert suggest action">
          <div>
            <strong>{t("console.agent_hosts_suggest_title")}</strong>
            <ul>
              {suggestedNames.map(({ secret, hosts }) => (
                <li key={secret.name}>
                  <code>{secret.name}</code> → <code>{hosts.join(", ")}</code>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="btn primary sm" onClick={applySuggestions}>
            {t("console.agent_hosts_apply")}
          </button>
        </div>
      )}

      {duplicates.length > 0 && editable && (
        <div className="alert warn action">
          <span>{t("console.duplicates_found", { count: duplicates.length })}</span>
          <button
            type="button"
            className="btn danger sm"
            onClick={() => setModal({ kind: "remove-duplicates" })}
          >
            {t("console.remove_duplicates", { count: duplicates.length })}
          </button>
        </div>
      )}
      {!unlocked && (
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

      <EnvironmentTabs
        environments={environments}
        environment={environment}
        ciTab={ciTab}
        secrets={secrets}
        missing={missing}
        guarded={guarded}
        canManage={canManage}
        tab={tab}
        onAddEnvironment={() => setModal({ kind: "add-env" })}
      />

      {ciTab ? (
        <section className="panel">
          <RepositoryLinks project={project} canManage={canManage} />
        </section>
      ) : (
        <section className="panel">
          <div className="toolbar">
            <SearchInput
              value={query}
              onInput={setQuery}
              placeholder={t("console.search_secrets")}
            />
            {environment && guarded(environment.id) && (
              <span className="lock-pill" title={t("console.protected_tip")}>
                <Icon name="lock" />
                {t("console.protected")}
              </span>
            )}
            {environment && (
              <button
                type="button"
                className="btn ghost"
                disabled={!secrets?.[environment.id]?.length}
                onClick={() => {
                  const list = secrets?.[environment.id] ?? [];
                  if (list.some((secret) => !isVariable(secret))) {
                    noteAccess(orgId, project, environment.id, "exported");
                  }
                  void navigator.clipboard
                    .writeText(formatDotenv(list))
                    .then(() => toast(t("projects.copied")));
                }}
              >
                <Icon name="copy" />
                {t("projects.copy_env")}
              </button>
            )}
          </div>

          {!secrets ? (
            <SkeletonTable />
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
                editable={writable(environment.id)}
                busyIds={busyIds}
                onSave={(secret, value, kind) => {
                  setSecrets((current) =>
                    current
                      ? {
                          ...current,
                          [environment.id]: (current[environment.id] ?? []).map((entry) =>
                            entry.id === secret.id ? { ...entry, value, kind } : entry,
                          ),
                        }
                      : current,
                  );
                  return mutate(
                    () =>
                      saveSecret(orgId, project, environment.id, {
                        id: secret.id,
                        name: secret.name,
                        value,
                        kind,
                        hosts: secret.hosts,
                      }),
                    "projects.saved",
                    [secret.id],
                  );
                }}
                onDelete={(secret) => setModal({ kind: "delete-secret", secret })}
                onHosts={(secret, hosts) => {
                  const targets = all.filter(
                    (entry) =>
                      entry.name === secret.name &&
                      !isVariable(entry) &&
                      writable(entry.environmentId),
                  );
                  void mutate(
                    () =>
                      saveSecrets(
                        orgId,
                        project,
                        targets.map((entry) => withHosts(entry, hosts)),
                      ),
                    "console.agent_hosts_saved",
                    targets.map((entry) => entry.id),
                  );
                }}
                onHistory={(secret) => setModal({ kind: "history", secret })}
                onAccess={(access, secretId) =>
                  noteAccess(orgId, project, environment.id, access, secretId)
                }
              />
            )
          ) : (
            <Matrix
              names={matchingNames(names, query)}
              secrets={secrets}
              environments={environments}
              tab={tab}
            />
          )}
        </section>
      )}

      {modal?.kind === "add" && (
        <AddSecretDialog
          environments={writableEnvironments}
          selected={
            environment && writable(environment.id)
              ? [environment.id]
              : writableEnvironments.map((env) => env.id)
          }
          existing={secrets ?? {}}
          onClose={close}
          onSave={addSecret}
        />
      )}
      {modal?.kind === "import" && (
        <ImportDialog
          environments={writableEnvironments}
          environmentId={
            environment && writable(environment.id)
              ? environment.id
              : (writableEnvironments[0]?.id ?? "")
          }
          existing={secrets ?? {}}
          onClose={close}
          onImport={importText}
        />
      )}
      {modal?.kind === "add-env" && owner && (
        <AddEnvironmentDialog orgId={orgId} project={project} owner={owner} onClose={close} />
      )}
      {modal?.kind === "rename-env" && owner && environment && (
        <RenameEnvironmentDialog
          orgId={orgId}
          project={project}
          owner={owner}
          environment={environment}
          onClose={close}
        />
      )}
      {modal?.kind === "delete-env" && owner && environment && (
        <DeleteEnvironmentDialog
          orgId={orgId}
          project={project}
          owner={owner}
          environment={environment}
          secrets={secrets?.[environment.id] ?? []}
          onClose={close}
        />
      )}
      {modal?.kind === "rename" && owner && (
        <RenameProjectDialog orgId={orgId} project={project} owner={owner} onClose={close} />
      )}
      {modal?.kind === "delete-project" && (
        <DeleteProjectDialog orgId={orgId} project={project} count={names.length} onClose={close} />
      )}
      {modal?.kind === "remove-duplicates" && (
        <RemoveDuplicatesDialog
          count={duplicates.length}
          onClose={close}
          onConfirm={removeDuplicates}
        />
      )}
      {modal?.kind === "history" && (
        <SecretHistoryDialog
          orgId={orgId}
          project={project}
          secret={modal.secret}
          editable={writable(modal.secret.environmentId)}
          onRevealed={() =>
            noteAccess(orgId, project, modal.secret.environmentId, "revealed", modal.secret.id)
          }
          onClose={close}
          onRestore={(version) => {
            const { secret } = modal;
            setModal(null);
            void mutate(
              () =>
                saveSecret(orgId, project, secret.environmentId, {
                  id: secret.id,
                  name: secret.name,
                  value: version.value,
                  kind: secret.kind,
                  note: secret.note,
                  hosts: secret.hosts,
                }),
              "console.history_restored",
              [secret.id],
            );
          }}
        />
      )}
      {modal?.kind === "delete-secret" && (
        <DeleteSecretDialog
          secret={modal.secret}
          environmentName={environment?.name ?? ""}
          onClose={close}
          onConfirm={(secret) =>
            void mutate(() => deleteSecret(orgId, project, secret.id), "projects.secret_deleted", [
              secret.id,
            ])
          }
        />
      )}
    </>
  );
}
