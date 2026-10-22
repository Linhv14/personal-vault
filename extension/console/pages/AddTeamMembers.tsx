import { useState } from "preact/hooks";
import type { OrgMember, TeamAccess } from "#ext/lib/orgs.js";
import { Fingerprint } from "#ext/ui/components/Fingerprint.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { useT } from "#ext/ui/i18n.js";
import { Avatar, Dialog } from "../components.js";

const SHOWN = 8;
const EMAIL = /[^\s,;<>]+@[^\s,;<>]+/g;

export function AccessToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: TeamAccess;
  onChange: (access: TeamAccess) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const option = (access: TeamAccess, icon: "pencil" | "eye", label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === access}
      aria-selected={value === access}
      disabled={disabled}
      title={t(access === "view" ? "console.access_view_tip" : "console.access_edit_tip")}
      onClick={() => value !== access && onChange(access)}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
  return (
    <div
      className="segmented access-toggle"
      role="radiogroup"
      aria-label={t("console.team_access")}
    >
      {option("edit", "pencil", t("console.access_edit"))}
      {option("view", "eye", t("console.access_view"))}
    </div>
  );
}

export function AddTeamMembersDialog({
  candidates,
  onClose,
  onAdd,
}: {
  candidates: OrgMember[];
  onClose: () => void;
  onAdd: (members: OrgMember[], access: TeamAccess) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<OrgMember[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [access, setAccess] = useState<TeamAccess>("edit");
  const picked = new Set(chosen.map((member) => member.accountId));
  const needle = query.trim().toLowerCase();
  const matches = candidates.filter(
    (member) => !picked.has(member.accountId) && member.email.toLowerCase().includes(needle),
  );
  const add = (members: OrgMember[]) => {
    setChosen((current) => [
      ...current,
      ...members.filter((member) => !current.some((entry) => entry.accountId === member.accountId)),
    ]);
    setQuery("");
  };
  const paste = (text: string) => {
    const emails = [...new Set((text.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
    if (emails.length < 2) {
      return false;
    }
    const byEmail = new Map(candidates.map((member) => [member.email.toLowerCase(), member]));
    add(emails.flatMap((email) => byEmail.get(email) ?? []));
    setUnknown(emails.filter((email) => !byEmail.has(email)));
    return true;
  };

  return (
    <Dialog
      title={t("orgs.add_to_team")}
      submitLabel={t("console.add_people", { count: chosen.length })}
      busy={chosen.length === 0}
      onClose={onClose}
      onSubmit={() => chosen.length > 0 && onAdd(chosen, access)}
    >
      <div className="people-search">
        <Icon name="search" />
        <input
          type="search"
          autoFocus
          value={query}
          aria-label={t("console.find_people")}
          placeholder={t("console.find_people")}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onPaste={(event) => {
            if (paste(event.clipboardData?.getData("text") ?? "")) {
              event.preventDefault();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches[0]) {
                add([matches[0]]);
              }
            }
          }}
        />
        {needle && matches.length > 1 && (
          <button type="button" className="btn ghost sm" onClick={() => add(matches)}>
            <Icon name="plus" />
            {t("console.add_all", { count: matches.length })}
          </button>
        )}
      </div>

      {(needle || chosen.length === 0) && (
        <ul className="people-list" role="listbox">
          {matches.slice(0, SHOWN).map((member) => (
            <li key={member.accountId}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => add([member])}
              >
                <Avatar text={member.email} size="sm" />
                <span className="people-email">{member.email}</span>
                <Icon name="plus" />
              </button>
            </li>
          ))}
          {matches.length > SHOWN && <li className="people-more">+{matches.length - SHOWN}</li>}
          {matches.length === 0 && (
            <li className="people-more">
              {t(needle ? "console.no_match" : "console.everyone_in_team")}
            </li>
          )}
        </ul>
      )}

      {unknown.length > 0 && (
        <div className="chips">
          {unknown.map((email) => (
            <span className="chip bad" key={email} title={t("console.not_in_org")}>
              {email}
            </span>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="people-chosen-head">
          <span>{t("console.chosen_count", { count: chosen.length })}</span>
          <AccessToggle value={access} onChange={setAccess} />
        </div>
      )}
      {chosen.length > 0 && (
        <ul className="people-chosen">
          {chosen.map((member) => (
            <li key={member.accountId}>
              <Avatar text={member.email} size="sm" />
              <span className="people-email">{member.email}</span>
              <span title={t("console.verify_hint")}>
                <Fingerprint publicKey={member.publicKey} />
              </span>
              <IconButton
                icon="close"
                label={t("orgs.remove")}
                onClick={() =>
                  setChosen((current) =>
                    current.filter((entry) => entry.accountId !== member.accountId),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
