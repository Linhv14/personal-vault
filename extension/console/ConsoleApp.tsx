import type { ComponentChildren, ComponentType } from "preact";
import { Wordmark } from "../ui/components/Logo.js";
import type { MessageKey } from "../../src/i18n/index.js";
import { useEffect } from "preact/hooks";
import type { Identity } from "../../src/core/identity.js";
import type { IconName } from "../../src/ui/icons.js";
import { logoSvg } from "../../src/ui/logo.js";
import { acceptInvite, declineInvite, type OrgSummary } from "../lib/orgs.js";
import { flushAccess } from "../lib/projects.js";
import { Icon } from "../ui/components/Icon.js";
import { useT } from "../ui/i18n.js";
import { ActionButton, Avatar, PageSkeleton, ProgressBar, Toaster } from "./components.js";
import { ConsoleContext, useConsoleLoader, type ConsoleData } from "./data.js";
import { ROLE_LABEL } from "./labels.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { MembersPage } from "./pages/MembersPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { TeamsPage } from "./pages/TeamsPage.js";
import { InvitePage } from "./pages/InvitePage.js";
import { WelcomePage } from "./pages/WelcomePage.js";
import {
  href,
  location$,
  navigate,
  watchHash,
  type PersonalSection,
  type Route,
} from "./router.js";

export interface PersonalPage {
  section: PersonalSection;
  icon: IconName;
  label: MessageKey;
  view: ComponentType;
}

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

function sectionOf(route: Route): Section | null {
  if (route.page === "me" || route.page === "invite") {
    return null;
  }
  if (route.page === "project") {
    return "projects";
  }
  if (route.page === "team") {
    return "teams";
  }
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
  if (data.invites.length === 0) {
    return null;
  }
  return (
    <div className="invite-banner">
      {data.invites.map((invite) => (
        <div className="invite-banner-row" key={invite.id}>
          <Icon name="mail" />
          <span>
            {t("orgs.invited_to", { name: invite.orgName })} ·{" "}
            <span className="muted">{t(ROLE_LABEL[invite.role])}</span>
          </span>
          <ActionButton
            className="btn primary sm"
            onClick={() =>
              data.run(async () => {
                const orgId = await acceptInvite(invite.id);
                navigate(orgId, { page: "projects" });
              }, "orgs.joined")
            }
          >
            {t("orgs.accept")}
          </ActionButton>
          <ActionButton
            className="btn ghost sm"
            onClick={() => data.run(() => declineInvite(invite.id), "orgs.declined")}
          >
            {t("orgs.decline")}
          </ActionButton>
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
  personal = [],
}: {
  identity: Identity;
  account: string;
  footer?: ComponentChildren;
  personal?: PersonalPage[];
}) {
  const t = useT();
  const loader = useConsoleLoader(identity);
  const { data } = loader;
  useEffect(() => watchHash(), []);
  useEffect(() => {
    const flush = () => void flushAccess(true);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    addEventListener("visibilitychange", onHide);
    addEventListener("pagehide", flush);
    return () => {
      removeEventListener("visibilitychange", onHide);
      removeEventListener("pagehide", flush);
    };
  }, []);

  const brand = (
    <div className="brand">
      <span
        className="brand-logo"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: logoSvg("", false, true) }}
      />
      <Wordmark />
    </div>
  );

  const noOrg = loader.orgs !== null && loader.orgs.length === 0;
  const { route } = location$.value;
  const invitePage = route.page === "invite" && loader.orgs !== null && (
    <InvitePage inviteId={route.inviteId} account={account} run={loader.run} />
  );
  if (noOrg && personal.length === 0) {
    return (
      <div className="console solo">
        <header className="solo-head">{brand}</header>
        <main className="solo-main">
          {invitePage || (
            <>
              <Invitations data={{ invites: loader.invites, run: loader.run }} />
              <WelcomePage run={loader.run} error={loader.error} />
            </>
          )}
        </main>
        <ProgressBar />
        <Toaster />
      </div>
    );
  }

  const current = sectionOf(route);
  const personalPage =
    route.page === "me" ? personal.find((page) => page.section === route.section) : undefined;
  const orgId = data?.detail.org.id;

  const main = invitePage ? (
    invitePage
  ) : personalPage ? (
    <div className="personal">
      <personalPage.view />
    </div>
  ) : noOrg ? (
    <>
      <Invitations data={{ invites: loader.invites, run: loader.run }} />
      <WelcomePage run={loader.run} error={loader.error} />
    </>
  ) : data ? (
    <>
      <Invitations data={data} />
      {data.error && (
        <p className="alert" role="alert">
          {data.error}
        </p>
      )}
      <Page data={data} />
    </>
  ) : loader.error ? (
    <p className="alert">{loader.error}</p>
  ) : (
    <PageSkeleton />
  );

  const shell = (
    <div className="console">
      <aside className="sidebar">
        {brand}
        {personal.length > 0 && (
          <nav className="side-nav" aria-label={t("console.personal")}>
            <span className="side-group">{t("console.personal")}</span>
            {personal.map((page) => (
              <a
                key={page.section}
                href={href("", { page: "me", section: page.section })}
                aria-current={personalPage?.section === page.section ? "page" : undefined}
              >
                <Icon name={page.icon} />
                <span>{t(page.label)}</span>
              </a>
            ))}
          </nav>
        )}
        <nav className="side-nav" aria-label={t("orgs.title")}>
          {personal.length > 0 && <span className="side-group">{t("orgs.title")}</span>}
          {data && loader.orgs && <OrgSwitcher orgs={loader.orgs} current={data} />}
          {data && orgId
            ? SECTIONS.filter(
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
              ))
            : noOrg && (
                <a href="#/new/projects" aria-current={current !== null ? "page" : undefined}>
                  <Icon name="plus" />
                  <span>{t("orgs.create_title")}</span>
                </a>
              )}
        </nav>
        <div className="side-foot">
          <div className="side-account">
            <Avatar text={account} size="sm" />
            <span title={account}>{account}</span>
          </div>
          {footer}
        </div>
      </aside>
      <main className="main">{main}</main>
    </div>
  );

  return (
    <>
      {data ? <ConsoleContext.Provider value={data}>{shell}</ConsoleContext.Provider> : shell}
      <ProgressBar />
      <Toaster />
    </>
  );
}
