import { useEffect, useState } from "preact/hooks";
import { listProjects, type Project } from "../../../lib/projects.js";
import type { Team } from "../../../lib/orgs.js";
import { useOrg } from "../context.js";

export function useProjects() {
  const { detail, identity } = useOrg();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  const teams = detail.teams.filter((team) => team.wrappedKey);
  const signature = teams.map((team) => `${team.id}:${team.generation}`).join(",");

  const reload = async () => {
    try {
      const lists = await Promise.all(
        teams.map((team) => listProjects(detail.org.id, team, identity)),
      );
      setProjects(lists.flat().sort((a, b) => a.content.name.localeCompare(b.content.name)));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void reload();
  }, [detail.org.id, signature]);

  const teamOf = (project: Project): Team | undefined =>
    teams.find((team) => team.id === project.teamId);

  return { teams, projects, failed, reload, teamOf };
}
