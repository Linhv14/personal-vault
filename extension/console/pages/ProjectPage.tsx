import { useEffect, useState } from "preact/hooks";
import { suggestHosts } from "../../../src/core/agent-hosts.js";
import {
  formatDotenv,
  handleOf,
  isVariable,
  MAX_ENVIRONMENTS,
  newEnvironment,
  parseDotenv,
  type SecretKind,
} from "../../../src/core/projects.js";
import { describeError } from "../../../src/i18n/index.js";
import { isOrgAdmin } from "../../lib/orgs.js";
import {
  deleteProject,
  deleteSecret,
  deleteLink,
  deleteSecrets,
  importSecrets,
  listLinks,
  listSecrets,
  noteAccess,
  saveSecret,
  saveSecrets,
  protectEnvironment,
  upgradeLegacySecrets,
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
  PageSkeleton,
  SearchInput,
  SkeletonTable,
} from "../components.js";
import { attempt, pending$, toast, useConsole } from "../data.js";
import { href, navigate } from "../router.js";
import {
  AddSecretDialog,
  HostsDialog,
  ImportDialog,
  TypeToConfirmDialog,
  type SecretDraft,
} from "./project-dialogs.js";
import { RepositoryLinks } from "./RepositoryLinks.js";
import { SecretHistoryDialog } from "./SecretHistory.js";
import { SecretsTable } from "./SecretsTable.js";

const CI_TAB = "ci";

type Modal =
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "rename" }
  | { kind: "add-env" }
  | { kind: "rename-env" }
  | { kind: "delete-env" }
  | { kind: "delete-project" }
  | { kind: "delete-secret"; secret: Secret }
  | { kind: "hosts"; secret: Secret }
  | { kind: "history"; secret: Secret }
  | { kind: "remove-duplicates" }
  | null;

function withHosts(secret: Secret, hosts: string[]) {
  return {
    id: secret.id,
    environmentId: secret.environmentId,
    name: secret.name,
    value: secret.value,
    kind: secret.kind,
    note: secret.note,
    hosts,
  };
}

export function ProjectPage({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string | null;
}) {
  const t = useT();
  const { detail, identity, projects, team, me, run, reload, refreshing } = useConsole();
  const project = projects?.find((entry) => entry.id === projectId);
  const [secrets, setSecrets] = useState<Record<string, Secret[]> | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
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
      const byEnvironment = Object.fromEntries(lists) as Record<string, Secret[]>;
      setSecrets(byEnvironment);
      const owner = team(project.teamId);
      if (owner && !owner.rekeyNeeded) {
        const upgraded = await upgradeLegacySecrets(
          orgId,
          project,
          Object.values(byEnvironment).flat(),
        );
        if (upgraded > 0) await load();
      }
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, [project?.id, project?.generation, project?.content.environments.map((env) => env.id).join()]);

  if (!projects || (!project && (refreshing || pending$.value))) return <PageSkeleton />;
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

  const mutate = async (
    work: () => Promise<unknown>,
    done: Parameters<typeof t>[0],
    ids: string[] = [],
  ) => {
    setError(null);
    const mark = (on: boolean) =>
      setBusyIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    mark(true);
    const succeeded = await attempt(
      async () => {
        await work();
        toast(t(done));
        await load();
      },
      (failure) => describeError(failure, t),
    );
    if (!succeeded) await load();
    mark(false);
    void reload();
    return succeeded;
  };

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
  const duplicates = Object.values(secrets ?? {}).flatMap((list) =>
    [...list]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((secret, index, sorted) => sorted.findIndex((x) => x.name === secret.name) !== index)
      .filter((secret) => writable(secret.environmentId)),
  );
  const removeDuplicates = () =>
    void mutate(async () => {
      await deleteSecrets(
        orgId,
        project,
        duplicates.map((secret) => secret.id),
      );
    }, "console.duplicates_removed");
  const suggested = all
    .filter(
      (secret) =>
        writable(secret.environmentId) &&
        !isVariable(secret) &&
        !secret.hosts?.length &&
        secret.value,
    )
    .map((secret) => ({ secret, hosts: suggestHosts(secret.name, secret.value) }))
    .filter((entry) => entry.hosts.length > 0);
  const suggestedNames = [
    ...new Map(suggested.map((entry) => [entry.secret.name, entry])).values(),
  ];
  const applySuggestions = () =>
    void mutate(
      () =>
        saveSecrets(
          orgId,
          project,
          suggested.map((entry) => withHosts(entry.secret, entry.hosts)),
        ),
      "console.agent_hosts_applied",
      suggested.map((entry) => entry.secret.id),
    );
  const names = [...new Set(all.map((secret) => secret.name))].sort();
  const missing = environments.map((env) => ({
    env,
    count: names.filter((name) => !secrets?.[env.id]?.some((secret) => secret.name === name))
      .length,
  }));

  const actions = (
    <>
      {writableEnvironments.length > 0 && (
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
      <Menu label={t("console.more")}>
        <MenuItem
          icon="terminal"
          label={t("projects.copy_cli")}
          onSelect={() =>
            void navigator.clipboard
              .writeText(
                `7key run --project ${handleOf(project.content.name)} --env ${handleOf(
                  (environment ?? environments[0])?.name ?? "development",
                )} -- `,
              )
              .then(() => toast(t("projects.cli_copied")))
          }
        />
        <MenuItem
          icon="copy"
          label={t("projects.copy_id")}
          onSelect={() =>
            void navigator.clipboard
              .writeText(project.id)
              .then(() => toast(t("projects.id_copied")))
          }
        />
        {canManage && environment && (
          <MenuItem
            icon="lock"
            label={t(
              guarded(environment.id)
                ? "console.unprotect_environment"
                : "console.protect_environment",
              { env: environment.name },
            )}
            onSelect={() =>
              void run(
                () => protectEnvironment(orgId, project, environment.id, !guarded(environment.id)),
                guarded(environment.id)
                  ? "console.environment_unprotected"
                  : "console.environment_protected",
                "org",
              )
            }
          />
        )}
        {canManage && (
          <MenuItem
            icon="pencil"
            label={t("console.rename")}
            onSelect={() => setModal({ kind: "rename" })}
          />
        )}
        {canManage && (
          <>
            {duplicates.length > 0 && (
              <MenuItem
                icon="trash"
                label={t("console.remove_duplicates", { count: duplicates.length })}
                onSelect={() => setModal({ kind: "remove-duplicates" })}
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
          </>
        )}
      </Menu>
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
            <span>
              {t("console.secret_count", { count: secrets ? all.length : project.secretCount })}
            </span>
            {viewer && <Badge>{t("console.access_view")}</Badge>}
          </>
        }
        actions={actions}
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

      <nav className="tabs" role="tablist">
        <a href={tab(null)} role="tab" aria-selected={!environment && !ciTab}>
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
              {guarded(env.id) && <Icon name="lock" className="tab-lock" />}
              {env.name}
              <span className="tab-count">{secrets?.[env.id]?.length ?? "–"}</span>
              {gap > 0 && (
                <span className="tab-dot" title={t("console.missing_count", { count: gap })} />
              )}
            </a>
          );
        })}
        <a href={tab(CI_TAB)} role="tab" aria-selected={ciTab} className="tab-ci">
          <Icon name="terminal" />
          {t("ci.tab")}
        </a>
        {canManage && environments.length < MAX_ENVIRONMENTS && (
          <button type="button" className="tab-add" onClick={() => setModal({ kind: "add-env" })}>
            <Icon name="plus" />
            {t("console.environment")}
          </button>
        )}
      </nav>

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

          {environment && guarded(environment.id) && (
            <p className="alert info">
              {t(admin ? "console.protected_admin" : "console.protected_member")}
            </p>
          )}
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
                onHosts={(secret) => setModal({ kind: "hosts", secret })}
                onHistory={(secret) => setModal({ kind: "history", secret })}
                onAccess={(access, secretId) =>
                  noteAccess(orgId, project, environment.id, access, secretId)
                }
              />
            )
          ) : (
            <Matrix
              names={names.filter((name) =>
                name.toLowerCase().includes(query.trim().toLowerCase()),
              )}
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
          onClose={() => setModal(null)}
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
              for (const link of await listLinks(orgId, project)) {
                if (link.environmentId === environment.id)
                  await deleteLink(orgId, project, link.id);
              }
              const doomed = (secrets?.[environment.id] ?? []).map((secret) => secret.id);
              if (doomed.length > 0) await deleteSecrets(orgId, project, doomed);
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
      {modal?.kind === "remove-duplicates" && (
        <Dialog
          title={t("console.remove_duplicates", { count: duplicates.length })}
          description={t("console.remove_duplicates_text")}
          submitLabel={t("console.remove_duplicates", { count: duplicates.length })}
          danger
          onClose={() => setModal(null)}
          onSubmit={() => {
            setModal(null);
            removeDuplicates();
          }}
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
          onClose={() => setModal(null)}
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
      {modal?.kind === "hosts" && (
        <HostsDialog
          secret={modal.secret}
          environmentCount={writableEnvironments.length}
          onClose={() => setModal(null)}
          onSave={(hosts, everywhere) => {
            const { secret } = modal;
            setModal(null);
            const targets = everywhere
              ? all.filter(
                  (entry) =>
                    entry.name === secret.name &&
                    !isVariable(entry) &&
                    writable(entry.environmentId),
                )
              : [secret];
            void mutate(
              () =>
                saveSecrets(
                  orgId,
                  project,
                  targets.map((entry) => withHosts(entry, hosts)),
                ),
              "projects.saved",
              targets.map((entry) => entry.id),
            );
          }}
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
          onSubmit={() => {
            const { secret } = modal;
            setModal(null);
            void mutate(() => deleteSecret(orgId, project, secret.id), "projects.secret_deleted", [
              secret.id,
            ]);
          }}
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
            <Icon name="check" />
            {t("console.all_present")}
          </Badge>
        ) : (
          <Badge tone="warn">
            <Icon name="alert" />
            {t("console.incomplete", { count: incomplete })}
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
