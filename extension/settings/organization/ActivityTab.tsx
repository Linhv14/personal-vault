import type { AuditEvent } from "../../lib/orgs.js";
import { Card } from "../../ui/components/Card.js";
import { Icon } from "../../ui/components/Icon.js";
import { Initial } from "../../ui/components/Initial.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { useOrg } from "./context.js";
import { ACTION_LABEL } from "./labels.js";

const VISIBLE_EVENTS = 50;

export function ActivityTab() {
  const t = useT();
  const { detail, audit, emailOf } = useOrg();
  if (!audit) return null;

  const teamName = (id: string) =>
    detail.teams.find((team) => team.id === id)?.name ?? t("orgs.deleted_team");
  const target = ({ action, actor, target }: AuditEvent) => {
    if (!target || target === actor || action.startsWith("secret")) return "";
    const [first = "", second] = target.split(":");
    if (action.startsWith("project.")) return ` ${teamName(first)}`;
    if (second) return ` ${emailOf(second)} → ${teamName(first)}`;
    return ` ${action.startsWith("team.") ? teamName(target) : emailOf(target)}`;
  };

  return (
    <Card>
      <p className={audit.verified ? "chain-status ok" : "chain-status broken"}>
        <Icon name={audit.verified ? "check" : "alert"} />
        {t(audit.verified ? "orgs.audit_verified" : "orgs.audit_broken")}
      </p>
      <ul className="timeline">
        {audit.events.slice(0, VISIBLE_EVENTS).map((event) => {
          const label = ACTION_LABEL[event.action];
          return (
            <li key={event.seq}>
              <Initial text={emailOf(event.actor)} />
              <span className="timeline-text">
                <span>
                  <strong>{emailOf(event.actor)}</strong> {label ? t(label) : event.action}
                  {target(event)}
                </span>
                <small>
                  {formatDateTime(event.at, localeSignal.value)}
                  {event.ip ? ` · ${event.ip}` : ""}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
