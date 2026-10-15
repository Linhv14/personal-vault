import { planLimits, removeMember } from "../../lib/orgs.js";
import { Button } from "../../ui/components/Button.js";
import { Fingerprint } from "../../ui/components/Fingerprint.js";
import { Icon } from "../../ui/components/Icon.js";
import { Initial } from "../../ui/components/Initial.js";
import { useT } from "../../ui/i18n.js";
import { useOrg } from "./context.js";
import { ROLE_LABEL } from "./labels.js";

export function OrgHeader() {
  const t = useT();
  const { detail, identity, isMe, run } = useOrg();
  const { org, members, invites, teams } = detail;
  const limits = planLimits(org.plan);
  const me = members.find((member) => isMe(member.publicKey));

  const leave = () => {
    if (me && confirm(t("orgs.leave_confirm", { name: org.name }))) {
      void run(() => removeMember(org.id, me.accountId), "orgs.left");
    }
  };

  return (
    <div className="org-hero">
      <Initial text={org.name} className="org-mark" />
      <div className="org-hero-text">
        <h2>{org.name}</h2>
        <p>
          {t(ROLE_LABEL[org.role])} · {t(org.plan === "team" ? "orgs.plan_team" : "orgs.plan_free")}{" "}
          · {t("orgs.seats", { used: members.length + invites.length, limit: limits.seats })} ·{" "}
          {t("orgs.team_count", { count: teams.length })}
        </p>
        <span className="key-chip" title={t("orgs.fingerprint_hint")}>
          <Icon name="key" />
          {t("orgs.your_fingerprint")} <Fingerprint publicKey={identity.publicKey} />
        </span>
      </div>
      {org.role !== "owner" && me && (
        <Button className="quiet" onClick={leave}>
          {t("orgs.leave")}
        </Button>
      )}
    </div>
  );
}
