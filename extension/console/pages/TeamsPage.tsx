import { useState } from "preact/hooks";
import { formText } from "#ui/form-data.js";
import { createTeam, isOrgAdmin, planLimits } from "#ext/lib/orgs.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { useT } from "#ext/ui/i18n.js";
import { Avatar, Badge, Dialog, EmptyState, Field, PageHeader } from "../components.js";
import { useConsole } from "../data.js";
import { href, navigate } from "../router.js";

export function TeamsPage() {
  const t = useT();
  const { detail, identity, projects, emailOf, run } = useConsole();
  const [creating, setCreating] = useState(false);
  const { org, teams } = detail;
  const orgId = org.id;
  const limit = planLimits(org.plan).teams;
  const admin = isOrgAdmin(org.role);

  const newButton = admin && (
    <button
      type="button"
      className="btn primary"
      disabled={teams.length >= limit}
      title={teams.length >= limit ? t("error.orgs.team_limit", { limit }) : undefined}
      onClick={() => setCreating(true)}
    >
      <Icon name="plus" />
      {t("orgs.create_team")}
    </button>
  );

  return (
    <>
      <PageHeader title={t("orgs.teams")} actions={newButton} />
      {creating && (
        <Dialog
          title={t("orgs.create_team")}
          submitLabel={t("orgs.create")}
          onClose={() => setCreating(false)}
          onSubmit={(form) => {
            const name = formText(new FormData(form), "name").trim();
            void run(async () => {
              const id = await createTeam(orgId, name, identity);
              setCreating(false);
              navigate(orgId, { page: "team", teamId: id });
            }, "orgs.team_created");
          }}
        >
          <Field label={t("orgs.team_name")}>
            <input name="name" maxLength={80} required autoFocus placeholder="Backend" />
          </Field>
        </Dialog>
      )}

      {teams.length === 0 ? (
        <EmptyState
          icon="users"
          title={t("orgs.no_teams")}
          text={t("console.no_teams_text")}
          action={newButton}
        />
      ) : (
        <section className="panel">
          <table className="table clickable">
            <thead>
              <tr>
                <th>{t("console.secret_name")}</th>
                <th>{t("orgs.members")}</th>
                <th className="num">{t("projects.tab")}</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const link = href(orgId, { page: "team", teamId: team.id });
                const count = projects?.filter((project) => project.teamId === team.id).length;
                return (
                  <tr key={team.id} onClick={() => (location.hash = link)}>
                    <td>
                      <a className="cell-title" href={link}>
                        <span className="cell-icon">
                          <Icon name="users" />
                        </span>
                        {team.name}
                      </a>
                      {team.rekeyNeeded && <Badge tone="warn">{t("orgs.rekey_needed")}</Badge>}
                      {!team.wrappedKey && <Badge>{t("console.access_none")}</Badge>}
                    </td>
                    <td>
                      <div className="avatar-stack" title={team.members.map(emailOf).join(", ")}>
                        {team.members.slice(0, 5).map((id) => (
                          <Avatar text={emailOf(id)} size="sm" key={id} />
                        ))}
                        <span className="muted">{team.members.length}</span>
                        {(team.pending?.length ?? 0) > 0 && (
                          <span className="pending-pill" title={t("console.waiting_tip")}>
                            <Icon name="clock" />
                            {team.pending?.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{team.wrappedKey ? (count ?? "–") : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
