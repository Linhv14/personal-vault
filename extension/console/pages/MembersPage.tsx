import { useState } from "preact/hooks";
import { canChangeRoles, canInvite, canRemove } from "../../../src/core/org-model.js";
import {
  inviteMember,
  isOrgAdmin,
  planLimits,
  removeMember,
  setMemberRole,
  transferOwnership,
  withdrawInvite,
  type OrgMember,
} from "../../lib/orgs.js";
import { Fingerprint } from "../../ui/components/Fingerprint.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import {
  Avatar,
  Badge,
  Dialog,
  Field,
  PageHeader,
  SearchInput,
  Usage,
  When,
} from "../components.js";
import { useConsole } from "../data.js";
import { ROLE_LABEL } from "../labels.js";

type Modal =
  | { kind: "invite" }
  | { kind: "remove"; member: OrgMember }
  | { kind: "transfer"; member: OrgMember }
  | { kind: "verify"; member: OrgMember }
  | null;

export function MembersPage() {
  const t = useT();
  const { detail, me, run } = useConsole();
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const { org, members, invites, teams } = detail;
  const orgId = org.id;
  const seats = planLimits(org.plan).seats;
  const used = members.length + invites.length;
  const needle = query.trim().toLowerCase();
  const visible = members.filter((member) => member.email.includes(needle));
  const teamsOf = (accountId: string) => teams.filter((team) => team.members.includes(accountId));

  return (
    <>
      <PageHeader
        title={t("orgs.members")}
        actions={
          isOrgAdmin(org.role) && (
            <button
              type="button"
              className="btn primary"
              disabled={used >= seats}
              title={used >= seats ? t("error.orgs.seat_limit", { limit: seats }) : undefined}
              onClick={() => setModal({ kind: "invite" })}
            >
              <Icon name="mail" />
              {t("orgs.invite")}
            </button>
          )
        }
      />

      <section className="panel">
        <div className="toolbar">
          <SearchInput value={query} onInput={setQuery} placeholder={t("console.search_members")} />
          <Usage label={t("console.seats")} used={used} limit={seats} />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t("console.member")}</th>
              <th>{t("orgs.role")}</th>
              <th>{t("orgs.teams")}</th>
              <th aria-label={t("console.actions")} />
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => {
              const isMe = member.accountId === me?.accountId;
              const removable = me && !isMe && canRemove(me, member);
              return (
                <tr key={member.accountId}>
                  <td>
                    <span className="cell-title">
                      <Avatar text={member.email} size="sm" />
                      {member.email}
                      {isMe && <Badge>{t("orgs.you")}</Badge>}
                    </span>
                  </td>
                  <td>
                    {canChangeRoles(org.role) && member.role !== "owner" ? (
                      <select
                        className="compact"
                        value={member.role}
                        aria-label={t("orgs.role")}
                        onChange={(event) => {
                          const select = event.currentTarget;
                          if (select.value === "owner") {
                            select.value = member.role;
                            setModal({ kind: "transfer", member });
                            return;
                          }
                          const role = select.value === "admin" ? "admin" : "member";
                          void run(
                            () => setMemberRole(orgId, member.accountId, role),
                            "orgs.role_saved",
                          );
                        }}
                      >
                        <option value="owner">{t("orgs.role_owner")}</option>
                        <option value="admin">{t("orgs.role_admin")}</option>
                        <option value="member">{t("orgs.role_member")}</option>
                      </select>
                    ) : (
                      <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                        {t(ROLE_LABEL[member.role])}
                      </Badge>
                    )}
                  </td>
                  <td>
                    <div className="chips">
                      {teamsOf(member.accountId).map((team) => (
                        <span className="chip" key={team.id}>
                          {team.name}
                        </span>
                      ))}
                      {teamsOf(member.accountId).length === 0 && <span className="muted">–</span>}
                    </div>
                  </td>
                  <td className="row-actions">
                    {member.publicKey && !isMe && (
                      <IconButton
                        icon="key"
                        label={t("console.verify_key")}
                        onClick={() => setModal({ kind: "verify", member })}
                      />
                    )}
                    {removable && (
                      <IconButton
                        icon="close"
                        label={t("orgs.remove")}
                        onClick={() => setModal({ kind: "remove", member })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">{t("orgs.pending")}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t("orgs.invite_email")}</th>
                <th>{t("orgs.role")}</th>
                <th>{t("console.expires")}</th>
                <th aria-label={t("console.actions")} />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>
                    <span className="cell-title">
                      <Avatar text={invite.email} size="sm" />
                      {invite.email}
                    </span>
                  </td>
                  <td className="muted">{t(ROLE_LABEL[invite.role])}</td>
                  <td className="muted">
                    <When at={invite.expiresAt} />
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => void run(() => withdrawInvite(orgId, invite.id))}
                    >
                      {t("orgs.withdraw")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {modal?.kind === "invite" && (
        <Dialog
          title={t("orgs.invite")}
          description={t("console.invite_hint")}
          submitLabel={t("orgs.send_invite")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const data = new FormData(form);
            const role = data.get("role") === "admin" ? "admin" : "member";
            void run(async () => {
              await inviteMember(orgId, String(data.get("email")).trim(), role, localeSignal.value);
              setModal(null);
            }, "orgs.invited");
          }}
        >
          <Field label={t("orgs.invite_email")}>
            <input name="email" type="email" required autoFocus placeholder="name@company.com" />
          </Field>
          <Field label={t("orgs.role")} hint={t("console.role_hint")}>
            <select name="role">
              <option value="member">{t("orgs.role_member")}</option>
              {canInvite(org.role, "admin") && (
                <option value="admin">{t("orgs.role_admin")}</option>
              )}
            </select>
          </Field>
        </Dialog>
      )}
      {modal?.kind === "remove" && (
        <Dialog
          title={t("orgs.remove")}
          description={t("orgs.remove_confirm", { email: modal.member.email })}
          submitLabel={t("orgs.remove")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void run(async () => {
              await removeMember(orgId, modal.member.accountId);
              setModal(null);
            }, "orgs.removed")
          }
        />
      )}
      {modal?.kind === "verify" && (
        <Dialog
          title={t("console.verify_key")}
          submitLabel={t("console.done")}
          onClose={() => setModal(null)}
          onSubmit={() => setModal(null)}
        >
          <div className="verify">
            <span className="field-label">{modal.member.email}</span>
            <Fingerprint publicKey={modal.member.publicKey} />
            <p className="field-hint">{t("console.verify_hint")}</p>
          </div>
        </Dialog>
      )}
      {modal?.kind === "transfer" && (
        <Dialog
          title={t("console.transfer_title")}
          description={t("orgs.transfer_confirm", { email: modal.member.email })}
          submitLabel={t("console.transfer")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void run(async () => {
              await transferOwnership(orgId, modal.member.accountId);
              setModal(null);
            }, "orgs.transferred")
          }
        />
      )}
    </>
  );
}
