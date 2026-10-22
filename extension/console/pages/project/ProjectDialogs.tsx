import { formText } from "#ui/form-data.js";
import { newEnvironment, type Environment } from "#core/projects.js";
import type { Team } from "#ext/lib/orgs.js";
import {
  deleteLink,
  deleteProject,
  deleteSecrets,
  listLinks,
  updateProject,
  type Project,
  type Secret,
} from "#ext/lib/projects.js";
import { useT } from "#ext/ui/i18n.js";
import { Dialog, Field } from "#ext/console/components.js";
import { useConsole } from "#ext/console/data.js";
import { navigate } from "#ext/console/router.js";
import { TypeToConfirmDialog } from "../project-dialogs.js";

interface ProjectDialogProps {
  orgId: string;
  project: Project;
  onClose: () => void;
}

export function AddEnvironmentDialog({
  orgId,
  project,
  owner,
  onClose,
}: ProjectDialogProps & { owner: Team }) {
  const t = useT();
  const { identity, run } = useConsole();
  return (
    <Dialog
      title={t("console.add_environment")}
      description={t("console.add_environment_hint")}
      submitLabel={t("orgs.create")}
      onClose={onClose}
      onSubmit={(form) => {
        const name = formText(new FormData(form), "name").trim();
        const created = newEnvironment(name);
        void run(async () => {
          await updateProject(orgId, owner, identity, project, {
            ...project.content,
            environments: [...project.content.environments, created],
          });
          onClose();
          navigate(orgId, { page: "project", projectId: project.id, environmentId: created.id });
        }, "console.environment_added");
      }}
    >
      <Field label={t("console.environment_name")}>
        <input name="name" maxLength={40} required autoFocus placeholder="QA" />
      </Field>
    </Dialog>
  );
}

export function RenameEnvironmentDialog({
  orgId,
  project,
  owner,
  environment,
  onClose,
}: ProjectDialogProps & { owner: Team; environment: Environment }) {
  const t = useT();
  const { identity, run } = useConsole();
  return (
    <Dialog
      title={t("console.rename_environment", { env: environment.name })}
      submitLabel={t("projects.save")}
      onClose={onClose}
      onSubmit={(form) => {
        const name = formText(new FormData(form), "name").trim();
        void run(async () => {
          await updateProject(orgId, owner, identity, project, {
            ...project.content,
            environments: project.content.environments.map((env) =>
              env.id === environment.id ? { ...env, name } : env,
            ),
          });
          onClose();
        }, "console.renamed");
      }}
    >
      <Field label={t("console.environment_name")}>
        <input name="name" defaultValue={environment.name} maxLength={40} required autoFocus />
      </Field>
    </Dialog>
  );
}

export function DeleteEnvironmentDialog({
  orgId,
  project,
  owner,
  environment,
  secrets,
  onClose,
}: ProjectDialogProps & { owner: Team; environment: Environment; secrets: Secret[] }) {
  const t = useT();
  const { identity, run } = useConsole();
  return (
    <TypeToConfirmDialog
      title={t("console.delete_environment", { env: environment.name })}
      text={t("console.delete_environment_text", { count: secrets.length })}
      phrase={environment.name}
      submitLabel={t("projects.delete_secret")}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          for (const link of await listLinks(orgId, project)) {
            if (link.environmentId === environment.id) {
              await deleteLink(orgId, project, link.id);
            }
          }
          const doomed = secrets.map((secret) => secret.id);
          if (doomed.length > 0) {
            await deleteSecrets(orgId, project, doomed);
          }
          await updateProject(orgId, owner, identity, project, {
            ...project.content,
            environments: project.content.environments.filter((env) => env.id !== environment.id),
          });
          onClose();
          navigate(orgId, { page: "project", projectId: project.id, environmentId: null });
        }, "console.environment_deleted")
      }
    />
  );
}

export function RenameProjectDialog({
  orgId,
  project,
  owner,
  onClose,
}: ProjectDialogProps & { owner: Team }) {
  const t = useT();
  const { identity, run } = useConsole();
  return (
    <Dialog
      title={t("console.rename")}
      submitLabel={t("projects.save")}
      onClose={onClose}
      onSubmit={(form) => {
        const name = formText(new FormData(form), "name").trim();
        void run(async () => {
          await updateProject(orgId, owner, identity, project, { ...project.content, name });
          onClose();
        }, "console.renamed");
      }}
    >
      <Field label={t("projects.name")}>
        <input name="name" defaultValue={project.content.name} maxLength={80} required autoFocus />
      </Field>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  orgId,
  project,
  count,
  onClose,
}: ProjectDialogProps & { count: number }) {
  const t = useT();
  const { run } = useConsole();
  return (
    <TypeToConfirmDialog
      title={t("projects.delete")}
      text={t("console.delete_project_text", { count })}
      phrase={project.content.name}
      submitLabel={t("projects.delete")}
      onClose={onClose}
      onConfirm={() =>
        void run(async () => {
          await deleteProject(orgId, project);
          onClose();
          navigate(orgId, { page: "projects" });
        }, "projects.deleted")
      }
    />
  );
}

export function RemoveDuplicatesDialog({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      title={t("console.remove_duplicates", { count })}
      description={t("console.remove_duplicates_text")}
      submitLabel={t("console.remove_duplicates", { count })}
      danger
      onClose={onClose}
      onSubmit={() => {
        onClose();
        onConfirm();
      }}
    />
  );
}

export function DeleteSecretDialog({
  secret,
  environmentName,
  onClose,
  onConfirm,
}: {
  secret: Secret;
  environmentName: string;
  onClose: () => void;
  onConfirm: (secret: Secret) => void;
}) {
  const t = useT();
  return (
    <Dialog
      title={t("console.delete_secret_title")}
      description={t("projects.delete_secret_confirm", {
        name: secret.name,
        env: environmentName,
      })}
      highlight={[secret.name, environmentName]}
      submitLabel={t("projects.delete_secret")}
      danger
      onClose={onClose}
      onSubmit={() => {
        onClose();
        onConfirm(secret);
      }}
    />
  );
}
