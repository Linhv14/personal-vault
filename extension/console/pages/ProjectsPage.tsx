import { useState } from "preact/hooks";
import { isOrgAdmin } from "../../lib/orgs.js";
import { createProject } from "../../lib/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { Badge, Dialog, EmptyState, Field, PageHeader, SearchInput, When } from "../components.js";
import { useConsole } from "../data.js";
import { href, navigate } from "../router.js";

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { detail, identity, run, myTeams } = useConsole();
  const teams = myTeams.filter((team) => !team.rekeyNeeded);
  return (
    <Dialog
      title={t("projects.create")}
      submitLabel={t("orgs.create")}
      onClose={onClose}
      onSubmit={(form) => {
        const data = new FormData(form);
        const team = teams.find((entry) => entry.id === data.get("team"));
        if (!team) return;
        void run(async () => {
          const id = await createProject(
            detail.org.id,
            team,
            identity,
            String(data.get("name")).trim(),
          );
          onClose();
          navigate(detail.org.id, { page: "project", projectId: id, environmentId: null });
        }, "projects.created");
      }}
    >
      <Field label={t("projects.name")}>
        <input name="name" maxLength={80} required autoFocus placeholder="Payments API" />
      </Field>
      <Field label={t("projects.team")}>
        <select name="team">
          {teams.map((team) => (
            <option value={team.id} key={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}

export function ProjectsPage() {
  const t = useT();
  const { detail, projects, myTeams, team } = useConsole();
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const orgId = detail.org.id;
  const canCreate = isOrgAdmin(detail.org.role) && myTeams.some((entry) => !entry.rekeyNeeded);

  const visible = (projects ?? []).filter(
    (project) =>
      (teamFilter === "all" || project.teamId === teamFilter) &&
      project.content.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const newButton = canCreate && (
    <button type="button" className="btn primary" onClick={() => setCreating(true)}>
      <Icon name="plus" />
      {t("projects.create")}
    </button>
  );

  return (
    <>
      <PageHeader title={t("projects.tab")} actions={newButton} />
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}

      {myTeams.length === 0 ? (
        <EmptyState
          icon="users"
          title={t("console.no_team_title")}
          text={t("projects.join_team")}
          action={
            isOrgAdmin(detail.org.role) && (
              <a className="btn" href={href(orgId, { page: "teams" })}>
                {t("console.go_teams")}
              </a>
            )
          }
        />
      ) : projects?.length === 0 ? (
        <EmptyState
          icon="braces"
          title={t("projects.none")}
          text={t("console.no_projects_text")}
          action={newButton}
        />
      ) : (
        <section className="panel">
          <div className="toolbar">
            <SearchInput
              value={query}
              onInput={setQuery}
              placeholder={t("console.search_projects")}
            />
            {myTeams.length > 1 && (
              <select
                aria-label={t("projects.team")}
                value={teamFilter}
                onChange={(event) => setTeamFilter(event.currentTarget.value)}
              >
                <option value="all">{t("console.all_teams")}</option>
                {myTeams.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <table className="table clickable">
            <thead>
              <tr>
                <th>{t("projects.name")}</th>
                <th>{t("projects.team")}</th>
                <th>{t("projects.environments")}</th>
                <th className="num">{t("console.secrets")}</th>
                <th>{t("console.last_change")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => {
                const link = href(orgId, {
                  page: "project",
                  projectId: project.id,
                  environmentId: null,
                });
                return (
                  <tr key={project.id} onClick={() => (location.hash = link)}>
                    <td>
                      <a className="cell-title" href={link}>
                        <span className="cell-icon">
                          <Icon name="braces" />
                        </span>
                        {project.content.name}
                      </a>
                    </td>
                    <td>
                      <span className="muted">{team(project.teamId)?.name}</span>
                      {team(project.teamId)?.rekeyNeeded && (
                        <Badge tone="warn">{t("orgs.rekey_needed")}</Badge>
                      )}
                    </td>
                    <td>
                      <div className="chips">
                        {project.content.environments.map((env) => (
                          <span className="chip" key={env.id}>
                            {env.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num">{project.secretCount}</td>
                    <td className="muted">
                      <When at={project.updatedAt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && <p className="table-empty">{t("console.no_match")}</p>}
        </section>
      )}
    </>
  );
}
