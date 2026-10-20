import { useState } from "preact/hooks";
import {
  canChangeRoles,
  canInvite,
  canRemove,
  isDomainAllowed,
} from "../../../src/core/org-model.js";
import {
  inviteLink,
  inviteMember,
  isOrgAdmin,
  planLimits,
  removeMember,
  setMemberRole,
  transferOwnership,
  withdrawInvite,
  type OrgMember,
} from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { ApiError } from "../../lib/api.js";
import { currentAuthKey } from "../../lib/reauth.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import {
  ActionButton,
  Avatar,
  Badge,
  Dialog,
  Field,
  KeyCheck,
  RoleBadge,
  PageHeader,
  SearchInput,
  Usage,
  When,
} from "../components.js";
import { failure$, pending$, toast, useConsole } from "../data.js";

type Modal =
  | { kind: "invite" }
  | { kind: "remove"; member: OrgMember }
  | { kind: "transfer"; member: OrgMember }
  | { kind: "verify"; member: OrgMember }
  | { kind: "share-link"; email: string; link: string }
  | null;

export function MembersPage() {
  const t = useT();
  const { detail, me, run } = useConsole();
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const hide = (id: string) => setGone((current) => new Set(current).add(id));
  const { org } = detail;
  const members = detail.members.filter((member) => !gone.has(member.accountId));
  const invites = detail.invites.filter((invite) => !gone.has(invite.id));
  const { teams } = detail;
  const domains = org.allowedDomains;
  const domainList = domains.map((domain) => `@${domain}`).join(", ");
  const outside = (email: string) =>
    !isDomainAllowed(email, domains) && <Badge tone="warn">{t("console.outside_domain")}</Badge>;
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
          {isOrgAdmin(org.role) && <Usage label={t("console.seats")} used={used} limit={seats} />}
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
                      {outside(member.email)}
                    </span>
                  </td>
                  <td>
                    {canChangeRoles(org.role) && member.role !== "owner" ? (
                      <select
                        className="compact"
                        value={member.role}
                        aria-label={t("orgs.role")}
                        disabled={pending$.value}
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
                            "org",
                          );
                        }}
                      >
                        {member.role === "admin" && (
                          <option value="owner">{t("orgs.role_owner")}</option>
                        )}
                        <option value="admin">{t("orgs.role_admin")}</option>
                        <option value="member">{t("orgs.role_member")}</option>
                      </select>
                    ) : (
                      <RoleBadge role={member.role} />
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
                    <div className="row-actions-inner">
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
                          className="danger"
                          label={t("orgs.remove")}
                          onClick={() => setModal({ kind: "remove", member })}
                        />
                      )}
                    </div>
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
                <th>{t("console.email")}</th>
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
                      {outside(invite.email)}
                    </span>
                  </td>
                  <td>
                    <RoleBadge role={invite.role} />
                  </td>
                  <td className="muted">
                    <When at={invite.expiresAt} />
                  </td>
                  <td className="row-actions">
                    <div className="row-actions-inner">
                      <IconButton
                        icon="link"
                        label={t("invite.copy_link")}
                        onClick={() =>
                          void inviteLink(invite.id)
                            .then((link) => navigator.clipboard.writeText(link))
                            .then(() => toast(t("projects.copied")))
                        }
                      />
                      <ActionButton
                        className="btn sm"
                        onClick={() =>
                          run(
                            async () => {
                              const sent = await inviteMember(
                                orgId,
                                invite.email,
                                invite.role,
                                localeSignal.value,
                              );
                              if (!sent.emailed) {
                                setModal({
                                  kind: "share-link",
                                  email: invite.email,
                                  link: sent.link,
                                });
                              } else {
                                toast(t("invite.sent", { email: invite.email }));
                              }
                            },
                            undefined,
                            "org",
                          )
                        }
                      >
                        {t("invite.resend")}
                      </ActionButton>
                      <ActionButton
                        className="btn ghost sm danger-text"
                        onClick={() =>
                          run(
                            async () => {
                              await withdrawInvite(orgId, invite.id);
                              hide(invite.id);
                            },
                            "orgs.invite_withdrawn",
                            "org",
                          )
                        }
                      >
                        {t("orgs.withdraw")}
                      </ActionButton>
                    </div>
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
          submitLabel={t("orgs.send_invite")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const data = new FormData(form);
            const role = data.get("role") === "admin" ? "admin" : "member";
            const email = String(data.get("email")).trim();
            if (!isDomainAllowed(email, domains)) {
              failure$.value = t("error.orgs.domain_not_allowed", { domains: domainList });
              return;
            }
            void run(
              async () => {
                const sent = await inviteMember(orgId, email, role, localeSignal.value);
                if (sent.emailed) {
                  setModal(null);
                  toast(t("invite.sent", { email }));
                } else {
                  setModal({ kind: "share-link", email, link: sent.link });
                }
              },
              undefined,
              "org",
            );
          }}
        >
          <Field
            label={t("orgs.invite_email")}
            hint={
              domains.length > 0
                ? t("orgs.invite_domains_hint", { domains: domainList })
                : undefined
            }
          >
            <input
              name="email"
              type="email"
              required
              autoFocus
              placeholder={`name@${domains[0] ?? "company.com"}`}
              onInput={() => (failure$.value = null)}
            />
          </Field>
          <Field label={t("orgs.role")}>
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
          highlight={[modal.member.email]}
          submitLabel={t("orgs.remove")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void run(
              async () => {
                await removeMember(orgId, modal.member.accountId);
                hide(modal.member.accountId);
                setModal(null);
              },
              "orgs.removed",
              "org",
            )
          }
        />
      )}
      {modal?.kind === "verify" && (
        <Dialog
          title={t("console.verify_key")}
          description={t("console.verify_text")}
          submitLabel={t("console.done")}
          hideCancel
          onClose={() => setModal(null)}
          onSubmit={() => setModal(null)}
        >
          <KeyCheck email={modal.member.email} publicKey={modal.member.publicKey} />
        </Dialog>
      )}
      {modal?.kind === "share-link" && (
        <Dialog
          title={t("invite.share_title")}
          description={t("invite.share_text", { email: modal.email })}
          submitLabel={t("projects.copy")}
          onClose={() => setModal(null)}
          onSubmit={() =>
            void navigator.clipboard.writeText(modal.link).then(() => {
              toast(t("projects.copied"));
              setModal(null);
            })
          }
        >
          <div className="copy-field">
            <code>{modal.link}</code>
          </div>
        </Dialog>
      )}
      {modal?.kind === "transfer" && (
        <Dialog
          title={t("console.transfer_title")}
          description={t("console.transfer_text", { email: modal.member.email })}
          highlight={[modal.member.email]}
          submitLabel={t("console.transfer")}
          danger
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const password = String(new FormData(form).get("password"));
            void run(
              async () => {
                const authKey = await currentAuthKey(password);
                if (!authKey) throw new ApiError("error.crypto.wrong_password", 403);
                await transferOwnership(orgId, modal.member.accountId, authKey, localeSignal.value);
                setModal(null);
              },
              "orgs.transferred",
              "org",
            );
          }}
        >
          <ul className="consequences">
            <li>{t("console.transfer_they", { email: modal.member.email })}</li>
            <li>{t("console.transfer_you")}</li>
            <li>{t("console.transfer_undo")}</li>
          </ul>
          <Field label={t("console.confirm_password")}>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              onInput={() => (failure$.value = null)}
            />
          </Field>
        </Dialog>
      )}
    </>
  );
}
