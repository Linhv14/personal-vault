import { useState } from "preact/hooks";
import {
  addTeamMember,
  deleteTeam,
  isOrgAdmin,
  removeTeamMember,
  setTeamAccess,
  type OrgMember,
  type TeamAccess,
} from "../../lib/orgs.js";
import { rekeyTeam } from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import {
  ActionButton,
  Avatar,
  Badge,
  Dialog,
  EmptyState,
  Field,
  KeyCheck,
  RoleBadge,
  Menu,
  MenuItem,
  PageHeader,
  PageSkeleton,
  When,
} from "../components.js";
import { pending$, useConsole } from "../data.js";
import { href, navigate } from "../router.js";
import { TypeToConfirmDialog } from "./project-dialogs.js";

type Modal = { kind: "add" } | { kind: "remove"; member: OrgMember } | { kind: "delete" } | null;

function AddMemberDialog({
  candidates,
  onClose,
  onAdd,
}: {
  candidates: OrgMember[];
  onClose: () => void;
  onAdd: (member: OrgMember, access: TeamAccess) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState(candidates[0]?.accountId ?? "");
  const [access, setAccess] = useState<TeamAccess>("edit");
  const member = candidates.find((entry) => entry.accountId === selected);
  return (
    <Dialog
      title={t("orgs.add_to_team")}
      submitLabel={t("console.keys_match_add")}
      busy={!member}
      onClose={onClose}
      onSubmit={() => member && onAdd(member, access)}
    >
      <Field label={t("console.member")}>
        <select value={selected} onChange={(event) => setSelected(event.currentTarget.value)}>
          {candidates.map((entry) => (
            <option value={entry.accountId} key={entry.accountId}>
              {entry.email}
            </option>
          ))}
        </select>
      </Field>
      {member && !isOrgAdmin(member.role) && (
        <Field label={t("console.team_access")} hint={t("console.team_access_hint")}>
          <select
            value={access}
            onChange={(event) => setAccess(event.currentTarget.value as TeamAccess)}
          >
            <option value="edit">{t("console.access_edit")}</option>
            <option value="view">{t("console.access_view")}</option>
          </select>
        </Field>
      )}
      {member && <KeyCheck email={member.email} publicKey={member.publicKey} />}
    </Dialog>
  );
}

export function TeamPage({ teamId }: { teamId: string }) {
  const t = useT();
  const { detail, identity, projects, team: findTeam, run, refreshing } = useConsole();
  const [modal, setModal] = useState<Modal>(null);
  const team = findTeam(teamId);
  const orgId = detail.org.id;

  if (!team && (refreshing || pending$.value)) return <PageSkeleton />;
  if (!team) {
    return (
      <EmptyState
        icon="users"
        title={t("console.team_missing")}
        action={
          <a className="btn" href={href(orgId, { page: "teams" })}>
            {t("orgs.teams")}
          </a>
        }
      />
    );
  }

  const admin = isOrgAdmin(detail.org.role);
  const inTeam = Boolean(team.wrappedKey);
  const members = team.members
    .map((id) => detail.members.find((member) => member.accountId === id))
    .filter((member): member is OrgMember => Boolean(member));
  const candidates = detail.members.filter(
    (member) => member.publicKey && !team.members.includes(member.accountId),
  );
  const teamProjects = (projects ?? []).filter((project) => project.teamId === team.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("orgs.teams"), href: href(orgId, { page: "teams" }) }]}
        title={team.name}
        meta={t("orgs.team_members", { count: team.members.length })}
        actions={
          admin && (
            <>
              {inTeam && candidates.length > 0 && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setModal({ kind: "add" })}
                >
                  <Icon name="plus" />
                  {t("orgs.add_to_team")}
                </button>
              )}
              <Menu label={t("console.more")}>
                <MenuItem
                  icon="trash"
                  label={t("orgs.delete_team")}
                  danger
                  onSelect={() => setModal({ kind: "delete" })}
                />
              </Menu>
            </>
          )
        }
      />

      {team.rekeyNeeded && (
        <div className="alert warn action">
          <span>
            {t("orgs.rekey_hint")} {!(admin && inTeam) && t("orgs.rekey_other")}
          </span>
          {admin && inTeam && (
            <ActionButton
              className="btn primary"
              icon="key"
              onClick={() =>
                run(() => rekeyTeam(orgId, team, detail.members, identity), "orgs.rekeyed")
              }
            >
              {t("orgs.rekey")}
            </ActionButton>
          )}
        </div>
      )}
      {admin && !inTeam && <p className="alert">{t("orgs.not_in_team")}</p>}

      <section className="panel">
        <h2 className="panel-title">{t("orgs.members")}</h2>
        <table className="table">
          <thead>
            <tr>
              <th>{t("console.member")}</th>
              <th>{t("orgs.role")}</th>
              <th>{t("console.team_access")}</th>
              <th aria-label={t("console.actions")} />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.accountId}>
                <td>
                  <span className="cell-title">
                    <Avatar text={member.email} size="sm" />
                    {member.email}
                    {member.publicKey === identity.publicKey && <Badge>{t("orgs.you")}</Badge>}
                  </span>
                </td>
                <td>
                  <RoleBadge role={member.role} />
                </td>
                <td>
                  {isOrgAdmin(member.role) ? (
                    <span className="muted">{t("console.access_admin")}</span>
                  ) : admin ? (
                    <select
                      className="compact"
                      aria-label={t("console.team_access")}
                      value={team.viewers.includes(member.accountId) ? "view" : "edit"}
                      disabled={pending$.value}
                      onChange={(event) =>
                        void run(
                          () =>
                            setTeamAccess(
                              orgId,
                              team.id,
                              member.accountId,
                              event.currentTarget.value as TeamAccess,
                            ),
                          "console.access_saved",
                          "org",
                        )
                      }
                    >
                      <option value="edit">{t("console.access_edit")}</option>
                      <option value="view">{t("console.access_view")}</option>
                    </select>
                  ) : team.viewers.includes(member.accountId) ? (
                    t("console.access_view")
                  ) : (
                    t("console.access_edit")
                  )}
                </td>
                <td className="row-actions">
                  <div className="row-actions-inner">
                    {admin && (
                      <IconButton
                        icon="close"
                        className="danger"
                        label={t("orgs.remove")}
                        onClick={() => setModal({ kind: "remove", member })}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {inTeam && (
        <section className="panel">
          <h2 className="panel-title">{t("projects.tab")}</h2>
          {teamProjects.length === 0 ? (
            <p className="table-empty">{t("projects.none")}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("console.secret_name")}</th>
                  <th className="num">{t("console.secrets")}</th>
                  <th>{t("console.last_change")}</th>
                </tr>
              </thead>
              <tbody>
                {teamProjects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <a
                        className="cell-title"
                        href={href(orgId, {
                          page: "project",
                          projectId: project.id,
                          environmentId: null,
                        })}
                      >
                        <Icon name="braces" />
                        {project.content.name}
                      </a>
                    </td>
                    <td className="num">{project.secretCount}</td>
                    <td className="muted nowrap">
                      <When at={project.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {modal?.kind === "add" && (
        <AddMemberDialog
          candidates={candidates}
          onClose={() => setModal(null)}
          onAdd={(member, access) =>
            void run(
              async () => {
                await addTeamMember(orgId, team, member, identity, access);
                setModal(null);
              },
              "orgs.team_member_added",
              "org",
            )
          }
        />
      )}
      {modal?.kind === "remove" && (
        <Dialog
          title={t("orgs.remove")}
          description={t("console.remove_from_team", {
            email: modal.member.email,
            team: team.name,
          })}
          submitLabel={t("orgs.remove")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void run(async () => {
              await removeTeamMember(orgId, team.id, modal.member.accountId);
              setModal(null);
            }, "orgs.team_member_removed")
          }
        />
      )}
      {modal?.kind === "delete" && (
        <TypeToConfirmDialog
          title={t("orgs.delete_team")}
          text={t("console.delete_team_text", { count: teamProjects.length })}
          phrase={team.name}
          submitLabel={t("orgs.delete_team")}
          onClose={() => setModal(null)}
          onConfirm={() =>
            void run(async () => {
              await deleteTeam(orgId, team.id);
              setModal(null);
              navigate(orgId, { page: "teams" });
            }, "orgs.team_deleted")
          }
        />
      )}
    </>
  );
}
