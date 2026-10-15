import { acceptInvite, declineInvite, type MyInvite } from "../../lib/orgs.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Initial } from "../../ui/components/Initial.js";
import { useT } from "../../ui/i18n.js";
import type { Run } from "./context.js";
import { ROLE_LABEL } from "./labels.js";

export function InvitationsCard({
  invites,
  run,
  onJoined,
}: {
  invites: MyInvite[];
  run: Run;
  onJoined: (orgId: string) => void;
}) {
  const t = useT();
  if (invites.length === 0) return null;
  return (
    <Card>
      <h2>{t("orgs.invitations")}</h2>
      {invites.map((invite) => (
        <div className="invite-row" key={invite.id}>
          <Initial text={invite.orgName} className="org-mark small" />
          <span className="person-text">
            <strong>{invite.orgName}</strong>
            <small>{t(ROLE_LABEL[invite.role])}</small>
          </span>
          <Button
            variant="primary"
            onClick={() =>
              void run(async () => onJoined(await acceptInvite(invite.id)), "orgs.joined")
            }
          >
            {t("orgs.accept")}
          </Button>
          <Button className="quiet" onClick={() => void run(() => declineInvite(invite.id))}>
            {t("orgs.decline")}
          </Button>
        </div>
      ))}
    </Card>
  );
}
