import { useState } from "preact/hooks";
import { isOrgAdmin } from "../../lib/orgs.js";
import { useT } from "../../ui/i18n.js";
import { vaultKeySignal } from "../../ui/store/session.js";
import { ActivityTab } from "./ActivityTab.js";
import { OrgContext } from "./context.js";
import { CreateOrgCard } from "./CreateOrgCard.js";
import { InvitationsCard } from "./InvitationsCard.js";
import { MembersTab } from "./MembersTab.js";
import { OrgHeader } from "./OrgHeader.js";
import { ProjectsTab } from "./projects/ProjectsTab.js";
import { TeamsTab } from "./TeamsTab.js";
import { useOrganization } from "./useOrganization.js";

type Tab = "members" | "teams" | "projects" | "activity";

const TAB_VIEWS = {
  members: MembersTab,
  teams: TeamsTab,
  projects: ProjectsTab,
  activity: ActivityTab,
};

export function OrganizationPage({ dashboardUrl }: { dashboardUrl?: string }) {
  const t = useT();
  const vaultKey = vaultKeySignal.value;
  const state = useOrganization(vaultKey);
  const [tab, setTab] = useState<Tab>("members");

  if (!vaultKey) {
    return (
      <section className="page">
        <h1>{t("orgs.title")}</h1>
        <p className="notice">{t("settings.locked_hint")}</p>
      </section>
    );
  }

  const { identity, orgs, invites, orgId, detail, audit, error, run, select } = state;
  const allTabs: [Tab, string, number | null][] = detail
    ? [
        ["members", t("orgs.members"), detail.members.length],
        ["teams", t("orgs.teams"), detail.teams.length],
        ["projects", t("projects.tab"), null],
        ["activity", t("orgs.audit"), null],
      ]
    : [];
  const tabs = allTabs.filter(
    ([value]) => value !== "activity" || (detail !== null && isOrgAdmin(detail.org.role)),
  );
  const TabView = TAB_VIEWS[tab];

  return (
    <section className="page">
      <div className="page-head">
        <h1>{t("orgs.title")}</h1>
        {dashboardUrl && (
          <a className="button quiet" href={dashboardUrl} target="_blank" rel="noreferrer">
            {t("orgs.open_dashboard")}
          </a>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <InvitationsCard invites={invites} run={run} onJoined={(id) => void select(id)} />
      {orgs?.length === 0 && <CreateOrgCard run={run} />}
      {orgs && orgs.length > 1 && (
        <select
          className="org-switch"
          value={orgId ?? ""}
          aria-label={t("orgs.title")}
          onChange={(event) => void select(event.currentTarget.value)}
        >
          {orgs.map((org) => (
            <option value={org.id} key={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      )}
      {detail && identity && (
        <OrgContext.Provider value={{ detail, identity, audit, run }}>
          <OrgHeader />
          <nav className="org-tabs" role="tablist">
            {tabs.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? "org-tab active" : "org-tab"}
                onClick={() => {
                  setTab(value);
                  if (value === "activity") void run(async () => {});
                }}
              >
                {label}
                {count !== null && <span className="org-tab-count">{count}</span>}
              </button>
            ))}
          </nav>
          <TabView />
        </OrgContext.Provider>
      )}
    </section>
  );
}
