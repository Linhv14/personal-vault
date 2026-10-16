import { useEffect, useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import { auditLog, type AuditEvent } from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { ActionButton, Avatar, Badge, PageHeader, SkeletonTable, When } from "../components.js";
import { useConsole } from "../data.js";
import { ACTION_LABEL } from "../labels.js";

const PAGE = 100;
const CATEGORIES = ["all", "member", "team", "project", "secret", "ci"] as const;
type Category = (typeof CATEGORIES)[number];

function categoryOf(action: string): Category {
  if (action.startsWith("ci.") || action.startsWith("link.")) return "ci";
  if (action.startsWith("member") || action.startsWith("org.")) return "member";
  if (action.startsWith("team")) return "team";
  if (action.startsWith("project")) return "project";
  return "secret";
}

export function ActivityPage() {
  const t = useT();
  const { detail, emailOf, team, projects } = useConsole();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [more, setMore] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [error, setError] = useState<string | null>(null);
  const orgId = detail.org.id;

  const load = async (before?: number) => {
    try {
      const page = await auditLog(orgId, before);
      setEvents((current) => (before ? [...current, ...page.events] : page.events));
      setVerified(page.verified);
      setMore(page.events.length === PAGE);
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, [orgId]);

  const teamName = (id: string) => team(id)?.name ?? t("orgs.deleted_team");
  const project = (id: string) => projects?.find((entry) => entry.id === id);
  const projectLabel = (projectId: string, environmentId?: string) => {
    const found = project(projectId);
    if (!found) return t("console.other_project");
    const env = found.content.environments.find((entry) => entry.id === environmentId);
    return env ? `${found.content.name} · ${env.name}` : found.content.name;
  };
  const target = ({ action, actor, target }: AuditEvent) => {
    if (!target || target === actor) return "";
    const [first = "", second] = target.split(":");
    if (action.startsWith("secret") || action.startsWith("ci.") || action.startsWith("link.")) {
      return projectLabel(first, second);
    }
    if (action.startsWith("project.")) {
      return second && project(second)
        ? `${projectLabel(second)} (${teamName(first)})`
        : teamName(first);
    }
    if (second) return `${emailOf(second)} → ${teamName(first)}`;
    return action.startsWith("team.") ? teamName(target) : emailOf(target);
  };
  const who = (actor: string) => (actor.startsWith("github:") ? actor.slice(7) : emailOf(actor));
  const visible = events.filter(
    (event) => category === "all" || categoryOf(event.action) === category,
  );

  return (
    <>
      <PageHeader
        title={t("orgs.audit")}
        actions={
          verified !== null &&
          (verified ? (
            <Badge tone="ok">
              <Icon name="check" /> {t("console.chain_ok")}
            </Badge>
          ) : (
            <Badge tone="danger">
              <Icon name="alert" /> {t("orgs.audit_broken")}
            </Badge>
          ))
        }
      />
      {error && <p className="alert">{error}</p>}
      <section className="panel">
        <div className="toolbar">
          <div className="segmented" role="tablist">
            {CATEGORIES.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={category === entry}
                onClick={() => setCategory(entry)}
              >
                {t(`console.filter_${entry}`)}
              </button>
            ))}
          </div>
        </div>
        {verified === null && !error ? (
          <SkeletonTable rows={8} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("console.when")}</th>
                <th>{t("console.who")}</th>
                <th>{t("console.what")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => {
                const label = ACTION_LABEL[event.action];
                return (
                  <tr key={event.seq}>
                    <td
                      className="muted nowrap"
                      title={`${formatDateTime(event.at, localeSignal.value)}${event.ip ? ` · ${event.ip}` : ""}`}
                    >
                      <When at={event.at} />
                    </td>
                    <td>
                      <span className="cell-title">
                        <Avatar text={who(event.actor)} size="sm" />
                        {who(event.actor)}
                      </span>
                    </td>
                    <td>
                      {label ? t(label) : event.action} <strong>{target(event)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {verified !== null && visible.length === 0 && (
          <p className="table-empty">{t("console.no_match")}</p>
        )}
        {more && (
          <div className="table-more">
            <ActionButton onClick={() => load(events.at(-1)?.seq)}>
              {t("console.load_more")}
            </ActionButton>
          </div>
        )}
      </section>
    </>
  );
}
