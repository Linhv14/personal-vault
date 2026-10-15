import { useState } from "preact/hooks";
import { isOrgAdmin } from "../../../lib/orgs.js";
import { createProject, type Project } from "../../../lib/projects.js";
import { Button } from "../../../ui/components/Button.js";
import { Card } from "../../../ui/components/Card.js";
import { Icon } from "../../../ui/components/Icon.js";
import { useT } from "../../../ui/i18n.js";
import { useOrg } from "../context.js";
import { ProjectView } from "./ProjectView.js";
import { useProjects } from "./useProjects.js";

function CreateProjectForm({ onDone }: { onDone: (created: boolean) => void }) {
  const t = useT();
  const { detail, identity, run } = useOrg();
  const teams = detail.teams.filter((team) => team.wrappedKey && !team.rekeyNeeded);
  return (
    <form
      className="panel-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const team = teams.find((entry) => entry.id === data.get("team"));
        if (!team) return;
        void run(async () => {
          await createProject(detail.org.id, team, identity, String(data.get("name")).trim());
          onDone(true);
        }, "projects.created");
      }}
    >
      <input name="name" maxLength={80} placeholder={t("projects.name")} required autoFocus />
      <select name="team" aria-label={t("projects.team")}>
        {teams.map((team) => (
          <option value={team.id} key={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <Button variant="primary" type="submit">
        {t("orgs.create")}
      </Button>
      <Button className="quiet" type="button" onClick={() => onDone(false)}>
        {t("pin.cancel")}
      </Button>
    </form>
  );
}

export function ProjectsTab() {
  const t = useT();
  const { detail } = useOrg();
  const { teams, projects, failed, reload, teamOf } = useProjects();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = projects?.find((project) => project.id === openId);
  const team = open && teamOf(open);

  if (open && team) {
    return (
      <ProjectView
        project={open}
        team={team}
        onBack={() => setOpenId(null)}
        onChanged={() => void reload()}
      />
    );
  }

  const canCreate =
    isOrgAdmin(detail.org.role) && teams.some((entry) => !entry.rekeyNeeded) && !creating;

  return (
    <Card>
      <div className="section-head">
        <p className="row-hint">{t("projects.hint")}</p>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("projects.create")}
          </Button>
        )}
      </div>
      {creating && (
        <CreateProjectForm
          onDone={(created) => {
            setCreating(false);
            if (created) void reload();
          }}
        />
      )}
      {teams.length === 0 && <p className="empty">{t("projects.join_team")}</p>}
      {failed && <p className="error">{t("projects.load_failed")}</p>}
      {teams.length > 0 && projects?.length === 0 && !creating && (
        <p className="empty">{t("projects.none")}</p>
      )}
      <ul className="people projects">
        {projects?.map((project: Project) => (
          <li key={project.id}>
            <button type="button" className="project-row" onClick={() => setOpenId(project.id)}>
              <span className="team-mark">
                <Icon name="braces" />
              </span>
              <span className="person-text">
                <strong>{project.content.name}</strong>
                <small>
                  {teamOf(project)?.name} ·{" "}
                  {t("projects.environment_count", {
                    count: project.content.environments.length,
                  })}
                </small>
              </span>
              <Icon name="chevron" className="project-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
