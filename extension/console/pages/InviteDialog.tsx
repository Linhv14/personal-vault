import { useState } from "preact/hooks";
import { isDomainAllowed } from "#core/org-model.js";
import { formText } from "#ui/form-data.js";
import type { Team, TeamAccess } from "#ext/lib/orgs.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { useT } from "#ext/ui/i18n.js";
import { Dialog, Field } from "../components.js";
import { failure$ } from "../data.js";
import { AccessToggle } from "./AddTeamMembers.js";

export interface InviteDraft {
  email: string;
  role: "admin" | "member";
  teams: { teamId: string; access: TeamAccess }[];
}

export function InviteDialog({
  teams,
  domains,
  canInviteAdmin,
  onClose,
  onInvite,
}: {
  teams: Team[];
  domains: string[];
  canInviteAdmin: boolean;
  onClose: () => void;
  onInvite: (draft: InviteDraft) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<string[]>([]);
  const [access, setAccess] = useState<TeamAccess>("edit");
  const [role, setRole] = useState<"admin" | "member">("member");
  const domainList = domains.map((domain) => `@${domain}`).join(", ");
  const toggle = (teamId: string) =>
    setChosen((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    );
  return (
    <Dialog
      title={t("orgs.invite")}
      submitLabel={t("orgs.send_invite")}
      onClose={onClose}
      onSubmit={(form) => {
        const email = formText(new FormData(form), "email").trim();
        if (!isDomainAllowed(email, domains)) {
          failure$.value = t("error.orgs.domain_not_allowed", { domains: domainList });
          return;
        }
        onInvite({
          email,
          role,
          teams: chosen.map((teamId) => ({ teamId, access })),
        });
      }}
    >
      <Field
        label={t("orgs.invite_email")}
        hint={
          domains.length > 0 ? t("orgs.invite_domains_hint", { domains: domainList }) : undefined
        }
      >
        <input
          name="email"
          type="email"
          required
          autoFocus
          placeholder={`name@${domains[0] ?? "company.com"}`}
          onInput={() => (failure$.value = null)}
        />
      </Field>
      <Field label={t("orgs.role")}>
        <div className="segmented" role="radiogroup" aria-label={t("orgs.role")}>
          {(canInviteAdmin ? (["member", "admin"] as const) : (["member"] as const)).map(
            (value) => (
              <button
                type="button"
                role="radio"
                key={value}
                aria-checked={role === value}
                aria-selected={role === value}
                onClick={() => setRole(value)}
              >
                {t(value === "admin" ? "orgs.role_admin" : "orgs.role_member")}
              </button>
            ),
          )}
        </div>
      </Field>
      {teams.length > 0 && (
        <div className="invite-teams">
          <div className="invite-teams-head">
            <span className="field-label">{t("orgs.teams")}</span>
            {chosen.length > 0 && role === "member" && (
              <AccessToggle value={access} onChange={setAccess} />
            )}
          </div>
          <div className="team-chips">
            {teams.map((team) => {
              const on = chosen.includes(team.id);
              return (
                <button
                  type="button"
                  key={team.id}
                  className="team-chip"
                  aria-pressed={on}
                  onClick={() => toggle(team.id)}
                >
                  <Icon name={on ? "check" : "plus"} />
                  {team.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
