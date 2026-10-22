import type { Environment } from "../../../../src/core/projects.js";
import { protectEnvironment, type Project } from "../../../lib/projects.js";
import { Icon } from "../../../ui/components/Icon.js";
import { useT } from "../../../ui/i18n.js";
import { Menu, MenuItem } from "../../components.js";
import { toast, useConsole } from "../../data.js";
import { cliCommand, type Modal } from "./helpers.js";

export function ProjectActions({
  orgId,
  project,
  environment,
  canAdd,
  canManage,
  guarded,
  duplicateCount,
  open,
}: {
  orgId: string;
  project: Project;
  environment: Environment | null;
  canAdd: boolean;
  canManage: boolean;
  guarded: (envId: string) => boolean;
  duplicateCount: number;
  open: (modal: Modal) => void;
}) {
  const t = useT();
  const { run } = useConsole();
  const { environments } = project.content;
  return (
    <>
      {canAdd && (
        <>
          <button type="button" className="btn" onClick={() => open({ kind: "import" })}>
            <Icon name="upload" />
            {t("projects.import")}
          </button>
          <button type="button" className="btn primary" onClick={() => open({ kind: "add" })}>
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
              .writeText(cliCommand(project, environment ?? environments[0]))
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
            onSelect={() => open({ kind: "rename" })}
          />
        )}
        {canManage && (
          <>
            {duplicateCount > 0 && (
              <MenuItem
                icon="trash"
                label={t("console.remove_duplicates", { count: duplicateCount })}
                onSelect={() => open({ kind: "remove-duplicates" })}
              />
            )}
            <MenuItem
              icon="plus"
              label={t("console.add_environment")}
              onSelect={() => open({ kind: "add-env" })}
            />
            {environment && (
              <MenuItem
                icon="pencil"
                label={t("console.rename_environment", { env: environment.name })}
                onSelect={() => open({ kind: "rename-env" })}
              />
            )}
            {environment && environments.length > 1 && (
              <MenuItem
                icon="trash"
                label={t("console.delete_environment", { env: environment.name })}
                danger
                onSelect={() => open({ kind: "delete-env" })}
              />
            )}
            <MenuItem
              icon="trash"
              label={t("projects.delete")}
              danger
              onSelect={() => open({ kind: "delete-project" })}
            />
          </>
        )}
      </Menu>
    </>
  );
}
