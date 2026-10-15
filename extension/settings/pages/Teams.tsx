import { useEffect, useState } from "preact/hooks";
import type { Identity } from "../../../src/core/identity.js";
import { describeError, type MessageKey } from "../../../src/i18n/index.js";
import { ensureIdentity } from "../../lib/identity.js";
import {
  acceptInvite,
  addTeamMember,
  auditLog,
  createOrg,
  createTeam,
  declineInvite,
  deleteTeam,
  fingerprint,
  getOrg,
  inviteMember,
  isOrgAdmin,
  listOrgs,
  myInvites,
  removeMember,
  removeTeamMember,
  setMemberRole,
  withdrawInvite,
  type AuditEvent,
  type MyInvite,
  type OrgDetail,
  type OrgMember,
  type OrgSummary,
  type Team,
} from "../../lib/orgs.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { vaultKeySignal } from "../../ui/store/session.js";
import { showToast } from "../state.js";

const ROLE_LABEL: Record<OrgMember["role"], MessageKey> = {
  owner: "orgs.role_owner",
  admin: "orgs.role_admin",
  member: "orgs.role_member",
};

const ACTION_LABEL: Record<string, MessageKey> = {
  "org.created": "orgs.audit_org_created",
  "member.invited": "orgs.audit_member_invited",
  "member.joined": "orgs.audit_member_joined",
  "member.removed": "orgs.audit_member_removed",
  "member.role_changed": "orgs.audit_member_role_changed",
  "team.created": "orgs.audit_team_created",
  "team.member_added": "orgs.audit_team_member_added",
  "team.member_removed": "orgs.audit_team_member_removed",
  "team.deleted": "orgs.audit_team_deleted",
};

function Fingerprint({ publicKey }: { publicKey: string | null }) {
  const [print, setPrint] = useState("");
  useEffect(() => {
    if (publicKey) void fingerprint(publicKey).then(setPrint);
  }, [publicKey]);
  return <code className="fingerprint">{publicKey ? print : "—"}</code>;
}

export function Teams() {
  const t = useT();
  const vaultKey = vaultKeySignal.value;
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [audit, setAudit] = useState<{ events: AuditEvent[]; verified: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>, done?: MessageKey) => {
    setError(null);
    try {
      await work();
      if (done) showToast(t(done));
      await reload();
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  const reload = async (preferred = orgId) => {
    const [list, pending] = await Promise.all([listOrgs(), myInvites()]);
    setOrgs(list);
    setInvites(pending);
    const current = list.find((org) => org.id === preferred) ?? list[0] ?? null;
    setOrgId(current?.id ?? null);
    if (!current) {
      setDetail(null);
      setAudit(null);
      return;
    }
    const next = await getOrg(current.id);
    setDetail(next);
    setAudit(isOrgAdmin(next.org.role) ? await auditLog(current.id) : null);
  };

  useEffect(() => {
    if (!vaultKey) return;
    void ensureIdentity(vaultKey)
      .then(setIdentity)
      .then(() => reload())
      .catch((failure) => setError(describeError(failure, t)));
  }, [vaultKey]);

  if (!vaultKey) {
    return (
      <section className="page">
        <h1>{t("orgs.title")}</h1>
        <p className="notice">{t("settings.locked_hint")}</p>
      </section>
    );
  }

  const emailOf = (accountId: string) =>
    detail?.members.find((member) => member.accountId === accountId)?.email ?? accountId;

  return (
    <section className="page">
      <h1>{t("orgs.title")}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {invites.length > 0 && (
        <Card>
          <h2>{t("orgs.invitations")}</h2>
          {invites.map((invite) => (
            <div className="invite-row" key={invite.id}>
              <span className="org-mark small">{[...invite.orgName.trim()][0]?.toUpperCase()}</span>
              <span className="person-text">
                <strong>{invite.orgName}</strong>
                <small>{t(ROLE_LABEL[invite.role])}</small>
              </span>
              <Button
                variant="primary"
                onClick={() =>
                  void run(async () => {
                    const joined = await acceptInvite(invite.id);
                    setOrgId(joined);
                  }, "orgs.joined")
                }
              >
                {t("orgs.accept")}
              </Button>
              <Button className="quiet" onClick={() => void run(() => declineInvite(invite.id))}>
                {t("orgs.decline")}
              </Button>
            </div>
          ))}
        </Card>
      )}

      {orgs !== null && orgs.length === 0 && (
        <Card>
          <h2>{t("orgs.create_title")}</h2>
          <p className="row-hint">{t("orgs.create_hint")}</p>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get("name"));
              void run(() => createOrg(name), "orgs.created");
            }}
          >
            <input name="name" maxLength={80} placeholder={t("orgs.name")} required />
            <Button variant="primary" type="submit">
              {t("orgs.create")}
            </Button>
          </form>
        </Card>
      )}

      {orgs !== null && orgs.length > 1 && (
        <select
          className="org-switch"
          value={orgId ?? ""}
          aria-label={t("orgs.title")}
          onChange={(event) => void reload(event.currentTarget.value)}
        >
          {orgs.map((org) => (
            <option value={org.id} key={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      )}

      {detail && identity && (
        <OrgView detail={detail} identity={identity} audit={audit} emailOf={emailOf} run={run} />
      )}
    </section>
  );
}

type Tab = "members" | "teams" | "activity";

function Initial({ text }: { text: string }) {
  return <span className="initial">{[...text.trim()][0]?.toUpperCase() ?? "?"}</span>;
}

function OrgView({
  detail,
  identity,
  audit,
  emailOf,
  run,
}: {
  detail: OrgDetail;
  identity: Identity;
  audit: { events: AuditEvent[]; verified: boolean } | null;
  emailOf: (accountId: string) => string;
  run: (work: () => Promise<unknown>, done?: MessageKey) => Promise<void>;
}) {
  const t = useT();
  const locale = localeSignal.value;
  const { org, members, invites, teams } = detail;
  const admin = isOrgAdmin(org.role);
  const me = members.find((member) => member.publicKey === identity.publicKey);
  const [tab, setTab] = useState<Tab>("members");
  const [inviting, setInviting] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const teamName = (id: string) =>
    teams.find((team) => team.id === id)?.name ?? t("orgs.deleted_team");
  const describeTarget = (event: AuditEvent) => {
    if (!event.target || event.target === event.actor) return "";
    const [first, second] = event.target.split(":");
    if (second) return ` ${emailOf(second)} → ${teamName(first ?? "")}`;
    return event.action.startsWith("team.")
      ? ` ${teamName(event.target)}`
      : ` ${emailOf(event.target)}`;
  };
  const tabs: [Tab, string, number | null][] = [
    ["members", t("orgs.members"), members.length],
    ["teams", t("orgs.teams"), teams.length],
    ...(audit ? ([["activity", t("orgs.audit"), null]] as [Tab, string, null][]) : []),
  ];

  return (
    <>
      <div className="org-hero">
        <span className="org-mark">{[...org.name.trim()][0]?.toUpperCase()}</span>
        <div className="org-hero-text">
          <h2>{org.name}</h2>
          <p>
            {t(ROLE_LABEL[org.role])} · {t("orgs.member_count", { count: members.length })} ·{" "}
            {t("orgs.team_count", { count: teams.length })}
          </p>
          <span className="key-chip" title={t("orgs.fingerprint_hint")}>
            <Icon name="key" />
            {t("orgs.your_fingerprint")} <Fingerprint publicKey={identity.publicKey} />
          </span>
        </div>
        {org.role !== "owner" && me && (
          <Button
            className="quiet"
            onClick={() => {
              if (confirm(t("orgs.leave_confirm", { name: org.name }))) {
                void run(() => removeMember(org.id, me.accountId), "orgs.left");
              }
            }}
          >
            {t("orgs.leave")}
          </Button>
        )}
      </div>

      <nav className="org-tabs" role="tablist">
        {tabs.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "org-tab active" : "org-tab"}
            onClick={() => setTab(value)}
          >
            {label}
            {count !== null && <span className="org-tab-count">{count}</span>}
          </button>
        ))}
      </nav>

      {tab === "members" && (
        <Card>
          <div className="section-head">
            <p className="row-hint">{t("orgs.fingerprint_hint")}</p>
            {admin && !inviting && (
              <Button variant="primary" onClick={() => setInviting(true)}>
                {t("orgs.invite")}
              </Button>
            )}
          </div>
          {inviting && (
            <form
              className="panel-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  await inviteMember(
                    org.id,
                    String(data.get("email")),
                    data.get("role") === "admin" ? "admin" : "member",
                    locale,
                  );
                  form.reset();
                  setInviting(false);
                }, "orgs.invited");
              }}
            >
              <input
                name="email"
                type="email"
                placeholder={t("orgs.invite_email")}
                required
                autoFocus
              />
              <select name="role" aria-label={t("orgs.role")}>
                <option value="member">{t("orgs.role_member")}</option>
                {org.role === "owner" && <option value="admin">{t("orgs.role_admin")}</option>}
              </select>
              <Button variant="primary" type="submit">
                {t("orgs.send_invite")}
              </Button>
              <Button className="quiet" type="button" onClick={() => setInviting(false)}>
                {t("pin.cancel")}
              </Button>
            </form>
          )}
          <ul className="people">
            {members.map((member) => (
              <li key={member.accountId}>
                <Initial text={member.email} />
                <span className="person-text">
                  <strong>
                    {member.email}
                    {member.publicKey === identity.publicKey && (
                      <span className="you">{t("orgs.you")}</span>
                    )}
                  </strong>
                  <small>
                    <Fingerprint publicKey={member.publicKey} />
                  </small>
                </span>
                {org.role === "owner" && member.role !== "owner" ? (
                  <select
                    className="compact"
                    value={member.role}
                    aria-label={t("orgs.role")}
                    onChange={(event) =>
                      void run(
                        () =>
                          setMemberRole(
                            org.id,
                            member.accountId,
                            event.currentTarget.value as "admin" | "member",
                          ),
                        "orgs.role_saved",
                      )
                    }
                  >
                    <option value="admin">{t("orgs.role_admin")}</option>
                    <option value="member">{t("orgs.role_member")}</option>
                  </select>
                ) : (
                  <span className={`role-chip ${member.role}`}>{t(ROLE_LABEL[member.role])}</span>
                )}
                {member.role !== "owner" &&
                member.publicKey !== identity.publicKey &&
                (org.role === "owner" || (admin && member.role === "member")) ? (
                  <IconButton
                    icon="close"
                    label={t("orgs.remove")}
                    onClick={() => {
                      if (confirm(t("orgs.remove_confirm", { email: member.email }))) {
                        void run(() => removeMember(org.id, member.accountId), "orgs.removed");
                      }
                    }}
                  />
                ) : (
                  <span className="icon-spacer" />
                )}
              </li>
            ))}
          </ul>
          {invites.length > 0 && (
            <>
              <h3 className="sub-head">{t("orgs.pending")}</h3>
              <ul className="people pending">
                {invites.map((invite) => (
                  <li key={invite.id}>
                    <Initial text={invite.email} />
                    <span className="person-text">
                      <strong>{invite.email}</strong>
                      <small>
                        {t("orgs.invited_until", {
                          role: t(ROLE_LABEL[invite.role]),
                          date: formatDateTime(invite.expiresAt, locale),
                        })}
                      </small>
                    </span>
                    <Button
                      className="quiet"
                      onClick={() => void run(() => withdrawInvite(org.id, invite.id))}
                    >
                      {t("orgs.withdraw")}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {tab === "teams" && (
        <Card>
          <div className="section-head">
            <p className="row-hint">{t("orgs.teams_hint")}</p>
            {admin && !creatingTeam && (
              <Button variant="primary" onClick={() => setCreatingTeam(true)}>
                {t("orgs.create_team")}
              </Button>
            )}
          </div>
          {creatingTeam && (
            <form
              className="panel-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const name = String(new FormData(form).get("name"));
                void run(async () => {
                  await createTeam(org.id, name, identity);
                  form.reset();
                  setCreatingTeam(false);
                }, "orgs.team_created");
              }}
            >
              <input
                name="name"
                maxLength={80}
                placeholder={t("orgs.team_name")}
                required
                autoFocus
              />
              <Button variant="primary" type="submit">
                {t("orgs.create")}
              </Button>
              <Button className="quiet" type="button" onClick={() => setCreatingTeam(false)}>
                {t("pin.cancel")}
              </Button>
            </form>
          )}
          {teams.length === 0 && !creatingTeam && <p className="empty">{t("orgs.no_teams")}</p>}
          <div className="teams">
            {teams.map((team) => (
              <TeamRow
                key={team.id}
                orgId={org.id}
                team={team}
                admin={admin}
                members={members}
                identity={identity}
                emailOf={emailOf}
                run={run}
              />
            ))}
          </div>
        </Card>
      )}

      {tab === "activity" && audit && (
        <Card>
          <p className={audit.verified ? "chain-status ok" : "chain-status broken"}>
            <Icon name={audit.verified ? "check" : "alert"} />
            {t(audit.verified ? "orgs.audit_verified" : "orgs.audit_broken")}
          </p>
          <ul className="timeline">
            {audit.events.slice(0, 50).map((event) => (
              <li key={event.seq}>
                <Initial text={emailOf(event.actor)} />
                <span className="timeline-text">
                  <span>
                    <strong>{emailOf(event.actor)}</strong>{" "}
                    {ACTION_LABEL[event.action] ? t(ACTION_LABEL[event.action]!) : event.action}
                    {describeTarget(event)}
                  </span>
                  <small>
                    {formatDateTime(event.at, locale)}
                    {event.ip ? ` · ${event.ip}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function TeamRow({
  orgId,
  team,
  admin,
  members,
  identity,
  emailOf,
  run,
}: {
  orgId: string;
  team: Team;
  admin: boolean;
  members: OrgMember[];
  identity: Identity;
  emailOf: (accountId: string) => string;
  run: (work: () => Promise<unknown>, done?: MessageKey) => Promise<void>;
}) {
  const t = useT();
  const candidates = members.filter(
    (member) => member.publicKey && !team.members.includes(member.accountId),
  );
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
        <div className="chips">
          {team.members.map((accountId) => (
            <span className="member-chip" key={accountId}>
              {emailOf(accountId)}
              {admin && (
                <button
                  type="button"
                  aria-label={t("orgs.remove")}
                  onClick={() => void run(() => removeTeamMember(orgId, team.id, accountId))}
                >
                  <Icon name="close" />
                </button>
              )}
            </span>
          ))}
        </div>
        {admin && team.wrappedKey && candidates.length > 0 && (
          <form
            className="panel-form"
            onSubmit={(event) => {
              event.preventDefault();
              const accountId = String(new FormData(event.currentTarget).get("member"));
              const member = members.find((entry) => entry.accountId === accountId);
              if (member) {
                void run(
                  () => addTeamMember(orgId, team, member, identity),
                  "orgs.team_member_added",
                );
              }
            }}
          >
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
            <Button
              className="quiet danger-quiet"
              onClick={() => {
                if (confirm(t("orgs.delete_team_confirm", { name: team.name }))) {
                  void run(() => deleteTeam(orgId, team.id), "orgs.team_deleted");
                }
              }}
            >
              {t("orgs.delete_team")}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
