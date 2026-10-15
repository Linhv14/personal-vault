import { useState } from "preact/hooks";
import { canChangeRoles, canInvite, canRemove } from "../../../src/core/org-model.js";
import {
  inviteMember,
  isOrgAdmin,
  removeMember,
  setMemberRole,
  withdrawInvite,
  type OrgMember,
} from "../../lib/orgs.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Fingerprint } from "../../ui/components/Fingerprint.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { Initial } from "../../ui/components/Initial.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { useOrg } from "./context.js";
import { ROLE_LABEL } from "./labels.js";

function InviteForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { detail, run } = useOrg();
  const { org } = detail;
  return (
    <form
      className="panel-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const role = data.get("role") === "admin" ? "admin" : "member";
        void run(async () => {
          await inviteMember(org.id, String(data.get("email")), role, localeSignal.value);
          form.reset();
          onDone();
        }, "orgs.invited");
      }}
    >
      <input name="email" type="email" placeholder={t("orgs.invite_email")} required autoFocus />
      <select name="role" aria-label={t("orgs.role")}>
        <option value="member">{t("orgs.role_member")}</option>
        {canInvite(org.role, "admin") && <option value="admin">{t("orgs.role_admin")}</option>}
      </select>
      <Button variant="primary" type="submit">
        {t("orgs.send_invite")}
      </Button>
      <Button className="quiet" type="button" onClick={onDone}>
        {t("pin.cancel")}
      </Button>
    </form>
  );
}

function MemberRow({ member }: { member: OrgMember }) {
  const t = useT();
  const { detail, isMe, run } = useOrg();
  const { org, members } = detail;
  const actor = members.find((entry) => isMe(entry.publicKey));
  const removable = actor && !isMe(member.publicKey) && canRemove(actor, member);

  return (
    <li>
      <Initial text={member.email} />
      <span className="person-text">
        <strong>
          {member.email}
          {isMe(member.publicKey) && <span className="you">{t("orgs.you")}</span>}
        </strong>
        <small>
          <Fingerprint publicKey={member.publicKey} />
        </small>
      </span>
      {canChangeRoles(org.role) && member.role !== "owner" ? (
        <select
          className="compact"
          value={member.role}
          aria-label={t("orgs.role")}
          onChange={(event) => {
            const role = event.currentTarget.value === "admin" ? "admin" : "member";
            void run(() => setMemberRole(org.id, member.accountId, role), "orgs.role_saved");
          }}
        >
          <option value="admin">{t("orgs.role_admin")}</option>
          <option value="member">{t("orgs.role_member")}</option>
        </select>
      ) : (
        <span className={`role-chip ${member.role}`}>{t(ROLE_LABEL[member.role])}</span>
      )}
      {removable ? (
        <IconButton
          icon="close"
          label={t("orgs.remove")}
          onClick={() => {
            if (confirm(t("orgs.remove_confirm", { email: member.email }))) {
              void run(() => removeMember(org.id, member.accountId), "orgs.removed");
            }
          }}
        />
      ) : (
        <span className="icon-spacer" />
      )}
    </li>
  );
}

export function MembersTab() {
  const t = useT();
  const { detail, run } = useOrg();
  const { org, members, invites } = detail;
  const [inviting, setInviting] = useState(false);

  return (
    <Card>
      <div className="section-head">
        <p className="row-hint">{t("orgs.fingerprint_hint")}</p>
        {isOrgAdmin(org.role) && !inviting && (
          <Button variant="primary" onClick={() => setInviting(true)}>
            {t("orgs.invite")}
          </Button>
        )}
      </div>
      {inviting && <InviteForm onDone={() => setInviting(false)} />}
      <ul className="people">
        {members.map((member) => (
          <MemberRow member={member} key={member.accountId} />
        ))}
      </ul>
      {invites.length > 0 && (
        <>
          <h3 className="sub-head">{t("orgs.pending")}</h3>
          <ul className="people pending">
            {invites.map((invite) => (
              <li key={invite.id}>
                <Initial text={invite.email} />
                <span className="person-text">
                  <strong>{invite.email}</strong>
                  <small>
                    {t("orgs.invited_until", {
                      role: t(ROLE_LABEL[invite.role]),
                      date: formatDateTime(invite.expiresAt, localeSignal.value),
                    })}
                  </small>
                </span>
                <Button
                  className="quiet"
                  onClick={() => void run(() => withdrawInvite(org.id, invite.id))}
                >
                  {t("orgs.withdraw")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
