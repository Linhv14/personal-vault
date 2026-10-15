import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import type { Identity } from "../../src/core/identity.js";
import type { IconName } from "../../src/ui/icons.js";
import { logoSvg } from "../../src/ui/logo.js";
import { acceptInvite, declineInvite, type OrgSummary } from "../lib/orgs.js";
import { Icon } from "../ui/components/Icon.js";
import { Toast } from "../ui/components/Toast.js";
import { useT } from "../ui/i18n.js";
import { Avatar } from "./components.js";
import { ConsoleContext, failure$, toast$, useConsoleLoader, type ConsoleData } from "./data.js";
import { ROLE_LABEL } from "./labels.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { TeamsPage } from "./pages/TeamsPage.js";
import { WelcomePage } from "./pages/WelcomePage.js";
import { href, location$, navigate, watchHash, type Route } from "./router.js";

type Section = "projects" | "teams" | "members" | "activity" | "settings";

const SECTIONS: {
  section: Section;
  icon: IconName;
  label: Parameters<ReturnType<typeof useT>>[0];
}[] = [
  { section: "projects", icon: "braces", label: "projects.tab" },
  { section: "teams", icon: "users", label: "orgs.teams" },
  { section: "members", icon: "person", label: "orgs.members" },
  { section: "activity", icon: "history", label: "orgs.audit" },
  { section: "settings", icon: "gear", label: "console.settings" },
];

function sectionOf(route: Route): Section {
  if (route.page === "project") return "projects";
  if (route.page === "team") return "teams";
  return route.page;
}

function OrgSwitcher({ orgs, current }: { orgs: OrgSummary[]; current: ConsoleData }) {
  const t = useT();
  const { org } = current.detail;
  return (
    <div className="org-switch">
      <Avatar text={org.name} size="md" />
      <strong className="org-switch-name">{org.name}</strong>
      {orgs.length > 1 && (
        <select
          aria-label={t("orgs.title")}
          value={org.id}
          onChange={(event) => navigate(event.currentTarget.value, { page: "projects" })}
        >
          {orgs.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Invitations({ data }: { data: Pick<ConsoleData, "invites" | "run"> }) {
  const t = useT();
  if (data.invites.length === 0) return null;
  return (
    <div className="invite-banner">
      {data.invites.map((invite) => (
        <div className="invite-banner-row" key={invite.id}>
          <Icon name="mail" />
          <span>
            {t("orgs.invited_to", { name: invite.orgName })} ·{" "}
            <span className="muted">{t(ROLE_LABEL[invite.role])}</span>
          </span>
          <button
            type="button"
            className="btn primary sm"
            onClick={() =>
              void data.run(async () => {
                const orgId = await acceptInvite(invite.id);
                navigate(orgId, { page: "projects" });
              }, "orgs.joined")
            }
          >
            {t("orgs.accept")}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void data.run(() => declineInvite(invite.id))}
          >
            {t("orgs.decline")}
          </button>
        </div>
      ))}
    </div>
  );
}

function Page({ data }: { data: ConsoleData }) {
  const { route } = location$.value;
  switch (route.page) {
    case "project":
      return (
        <ProjectPage
          key={route.projectId}
          projectId={route.projectId}
          environmentId={route.environmentId}
        />
      );
    case "teams":
      return <TeamsPage />;
    case "team":
      return <TeamPage key={route.teamId} teamId={route.teamId} />;
    case "members":
      return <MembersPage />;
    case "activity":
      return <ActivityPage key={data.detail.org.id} />;
    case "settings":
      return <SettingsPage />;
    default:
      return <ProjectsPage />;
  }
}

export function ConsoleApp({
  identity,
  account,
  footer,
}: {
  identity: Identity;
  account: string;
  footer?: ComponentChildren;
}) {
  const t = useT();
  const loader = useConsoleLoader(identity);
  const { data } = loader;
  useEffect(() => watchHash(), []);

  const brand = (
    <div className="brand">
      <span
        className="brand-logo"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: logoSvg("console-logo") }}
      />
      <span className="wordmark">
        <span className="wordmark-accent">1</span>PW
      </span>
    </div>
  );

  if (loader.orgs && loader.orgs.length === 0) {
    return (
      <div className="console solo">
        <header className="solo-head">{brand}</header>
        <main className="solo-main">
          <Invitations data={{ invites: loader.invites, run: loader.run }} />
          <WelcomePage run={loader.run} error={loader.error} />
        </main>
        <Toast message={toast$.value} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="console loading">
        {brand}
        {loader.error ? <p className="alert">{loader.error}</p> : <span className="spinner" />}
      </div>
    );
  }

  const current = sectionOf(location$.value.route);
  const orgId = data.detail.org.id;

  return (
    <ConsoleContext.Provider value={data}>
      <div className="console">
        <aside className="sidebar">
          {brand}
          <OrgSwitcher orgs={data.orgs} current={data} />
          <nav className="side-nav">
            {SECTIONS.filter(
              ({ section }) => section !== "activity" || data.detail.org.role !== "member",
            ).map(({ section, icon, label }) => (
              <a
                key={section}
                href={href(orgId, { page: section })}
                aria-current={current === section ? "page" : undefined}
              >
                <Icon name={icon} />
                <span>{t(label)}</span>
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className="side-account">
              <Avatar text={account} size="sm" />
              <span title={account}>{account}</span>
            </div>
            {footer}
          </div>
        </aside>
        <main className="main">
          <Invitations data={data} />
          {(failure$.value ?? data.error) && (
            <p className="alert" role="alert">
              {failure$.value ?? data.error}
            </p>
          )}
          <Page data={data} />
        </main>
      </div>
      <Toast message={toast$.value} />
    </ConsoleContext.Provider>
  );
}
