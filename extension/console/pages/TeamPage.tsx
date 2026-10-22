import { useState } from "preact/hooks";
import {
  addTeamMember,
  deleteTeam,
  isOrgAdmin,
  removeTeamMember,
  setTeamAccess,
  type OrgMember,
} from "../../lib/orgs.js";
import { rekeyTeam } from "../../lib/projects.js";
import { Fingerprint } from "../../ui/components/Fingerprint.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import {
  ActionButton,
  Avatar,
  Badge,
  Dialog,
  EmptyState,
  RoleBadge,
  Menu,
  MenuItem,
  PageHeader,
  PageSkeleton,
  When,
} from "../components.js";
import { pending$, useConsole } from "../data.js";
import { href, navigate } from "../router.js";
import { AccessToggle, AddTeamMembersDialog } from "./AddTeamMembers.js";
import { TypeToConfirmDialog } from "./project-dialogs.js";

type Modal = { kind: "add" } | { kind: "remove"; member: OrgMember } | { kind: "delete" } | null;

export function TeamPage({ teamId }: { teamId: string }) {
  const t = useT();
  const { detail, identity, projects, team: findTeam, run, refreshing } = useConsole();
  const [modal, setModal] = useState<Modal>(null);
  const team = findTeam(teamId);
  const orgId = detail.org.id;

  if (!team && (refreshing || pending$.value)) {
    return <PageSkeleton />;
  }
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
  const waiting = (team.pending ?? []).flatMap((entry) => {
    const member = detail.members.find((candidate) => candidate.accountId === entry.accountId);
    return member ? [{ member, access: entry.access }] : [];
  });
  const grantable = waiting.filter((entry) => entry.member.publicKey);
  const invited = team.invited ?? [];
  const grant = (entries: typeof waiting) =>
    void run(
      async () => {
        for (const { member, access } of entries) {
          await addTeamMember(orgId, team, member, identity, access);
        }
      },
      "orgs.team_member_added",
      "org",
    );

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("orgs.teams"), href: href(orgId, { page: "teams" }) }]}
        title={team.name}
        meta={t("orgs.team_members", { count: team.members.length })}
        actions={
          admin && (
            <>
              {inTeam && grantable.length > 0 && (
                <button type="button" className="btn primary" onClick={() => grant(grantable)}>
                  <Icon name="key" />
                  {t("console.grant_access", { count: grantable.length })}
                </button>
              )}
              {inTeam && candidates.length > 0 && (
                <button
                  type="button"
                  className={grantable.length > 0 ? "btn" : "btn primary"}
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
                    <span className="access-static" title={t("console.access_admin")}>
                      <Icon name="shield" />
                      {t("console.access_full")}
                    </span>
                  ) : admin ? (
                    <AccessToggle
                      value={team.viewers.includes(member.accountId) ? "view" : "edit"}
                      disabled={pending$.value}
                      onChange={(access) =>
                        void run(
                          () => setTeamAccess(orgId, team.id, member.accountId, access),
                          "console.access_saved",
                          "org",
                        )
                      }
                    />
                  ) : team.viewers.includes(member.accountId) ? (
                    <span className="access-static">
                      <Icon name="eye" />
                      {t("console.access_view")}
                    </span>
                  ) : (
                    <span className="access-static">
                      <Icon name="pencil" />
                      {t("console.access_edit")}
                    </span>
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
            {admin &&
              waiting.map(({ member, access }) => (
                <tr key={member.accountId} className="member-pending">
                  <td>
                    <span className="cell-title">
                      <Avatar text={member.email} size="sm" />
                      {member.email}
                      <span title={t("console.verify_hint")}>
                        <Fingerprint publicKey={member.publicKey} />
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="pending-pill" title={t("console.waiting_tip")}>
                      <Icon name="clock" />
                      {t("console.waiting")}
                    </span>
                  </td>
                  <td>
                    <span className="access-static">
                      <Icon name={access === "view" ? "eye" : "pencil"} />
                      {t(access === "view" ? "console.access_view" : "console.access_edit")}
                    </span>
                  </td>
                  <td className="row-actions">
                    <div className="row-actions-inner">
                      {inTeam && member.publicKey && (
                        <IconButton
                          icon="key"
                          label={t("console.grant_access", { count: 1 })}
                          onClick={() => grant([{ member, access }])}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            {admin &&
              invited.map(({ email, access }) => (
                <tr key={email} className="member-pending">
                  <td>
                    <span className="cell-title">
                      <Avatar text={email} size="sm" />
                      {email}
                    </span>
                  </td>
                  <td>
                    <span className="access-static" title={t("console.invited_tip")}>
                      <Icon name="mail" />
                      {t("console.invited")}
                    </span>
                  </td>
                  <td>
                    <span className="access-static">
                      <Icon name={access === "view" ? "eye" : "pencil"} />
                      {t(access === "view" ? "console.access_view" : "console.access_edit")}
                    </span>
                  </td>
                  <td />
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
        <AddTeamMembersDialog
          candidates={candidates}
          onClose={() => setModal(null)}
          onAdd={(members, access) =>
            void run(
              async () => {
                for (const member of members) {
                  await addTeamMember(orgId, team, member, identity, access);
                }
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
          highlight={[modal.member.email, team.name]}
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
