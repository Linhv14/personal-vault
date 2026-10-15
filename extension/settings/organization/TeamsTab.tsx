import { useState } from "preact/hooks";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  fingerprint,
  isOrgAdmin,
  removeTeamMember,
  type Team,
} from "../../lib/orgs.js";
import { rekeyTeam } from "../../lib/projects.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { useOrg } from "./context.js";

function TeamCard({ team }: { team: Team }) {
  const t = useT();
  const { detail, identity, emailOf, run } = useOrg();
  const { org, members } = detail;
  const admin = isOrgAdmin(org.role);
  const candidates = members.filter(
    (member) => member.publicKey && !team.members.includes(member.accountId),
  );

  const add = (event: Event) => {
    event.preventDefault();
    const accountId = String(new FormData(event.currentTarget as HTMLFormElement).get("member"));
    const member = members.find((entry) => entry.accountId === accountId);
    if (!member?.publicKey) return;
    void fingerprint(member.publicKey).then((print) => {
      if (confirm(t("orgs.verify_fingerprint", { email: member.email, fingerprint: print }))) {
        void run(() => addTeamMember(org.id, team, member, identity), "orgs.team_member_added");
      }
    });
  };

  const remove = () => {
    if (confirm(t("orgs.delete_team_confirm", { name: team.name }))) {
      void run(() => deleteTeam(org.id, team.id), "orgs.team_deleted");
    }
  };

  return (
    <details className="team">
      <summary>
        <span className="team-mark">
          <Icon name="users" />
        </span>
        <span className="team-text">
          <strong>{team.name}</strong>
          <small>{t("orgs.team_members", { count: team.members.length })}</small>
        </span>
        {team.rekeyNeeded && <span className="warn-chip">{t("orgs.rekey_needed")}</span>}
        <Icon name="chevron" className="team-chevron" />
      </summary>
      <div className="team-body">
        {team.rekeyNeeded && (
          <div className="rekey">
            <p className="row-hint">
              {t("orgs.rekey_hint")} {!(admin && team.wrappedKey) && t("orgs.rekey_other")}
            </p>
            {admin && team.wrappedKey && (
              <Button
                variant="primary"
                onClick={() =>
                  void run(() => rekeyTeam(org.id, team, members, identity), "orgs.rekeyed")
                }
              >
                {t("orgs.rekey")}
              </Button>
            )}
          </div>
        )}
        <div className="chips">
          {team.members.map((accountId) => (
            <span className="member-chip" key={accountId}>
              {emailOf(accountId)}
              {admin && (
                <button
                  type="button"
                  aria-label={t("orgs.remove")}
                  onClick={() => void run(() => removeTeamMember(org.id, team.id, accountId))}
                >
                  <Icon name="close" />
                </button>
              )}
            </span>
          ))}
        </div>
        {admin && team.wrappedKey && candidates.length > 0 && (
          <form className="panel-form" onSubmit={add}>
            <select name="member" aria-label={t("orgs.add_to_team")}>
              {candidates.map((member) => (
                <option value={member.accountId} key={member.accountId}>
                  {member.email}
                </option>
              ))}
            </select>
            <Button type="submit">{t("orgs.add_to_team")}</Button>
          </form>
        )}
        {admin && !team.wrappedKey && <p className="row-hint">{t("orgs.not_in_team")}</p>}
        {admin && (
          <div className="team-foot">
            <Button className="quiet danger-quiet" onClick={remove}>
              {t("orgs.delete_team")}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function CreateTeamForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { detail, identity, run } = useOrg();
  return (
    <form
      className="panel-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = String(new FormData(form).get("name"));
        void run(async () => {
          await createTeam(detail.org.id, name, identity);
          form.reset();
          onDone();
        }, "orgs.team_created");
      }}
    >
      <input name="name" maxLength={80} placeholder={t("orgs.team_name")} required autoFocus />
      <Button variant="primary" type="submit">
        {t("orgs.create")}
      </Button>
      <Button className="quiet" type="button" onClick={onDone}>
        {t("pin.cancel")}
      </Button>
    </form>
  );
}

export function TeamsTab() {
  const t = useT();
  const { detail } = useOrg();
  const [creating, setCreating] = useState(false);
  const { org, teams } = detail;

  return (
    <Card>
      <div className="section-head">
        <p className="row-hint">{t("orgs.teams_hint")}</p>
        {isOrgAdmin(org.role) && !creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("orgs.create_team")}
          </Button>
        )}
      </div>
      {creating && <CreateTeamForm onDone={() => setCreating(false)} />}
      {teams.length === 0 && !creating && <p className="empty">{t("orgs.no_teams")}</p>}
      <div className="teams">
        {teams.map((team) => (
          <TeamCard team={team} key={team.id} />
        ))}
      </div>
    </Card>
  );
}
