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
            <div className="org-row" key={invite.id}>
              <span className="org-row-text">
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
              <Button onClick={() => void run(() => declineInvite(invite.id))}>
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
  const teamName = (id: string) =>
    teams.find((team) => team.id === id)?.name ?? t("orgs.deleted_team");
  const describeTarget = (event: AuditEvent) => {
    if (!event.target || event.target === event.actor) return "";
    const [first, second] = event.target.split(":");
    if (second) return ` · ${emailOf(second)} → ${teamName(first ?? "")}`;
    return event.action.startsWith("team.")
      ? ` · ${teamName(event.target)}`
      : ` · ${emailOf(event.target)}`;
  };

  return (
    <>
      <Card>
        <div className="org-head">
          <div>
            <h2>{org.name}</h2>
            <p className="row-hint">
              {t("orgs.your_role", { role: t(ROLE_LABEL[org.role]) })} ·{" "}
              {t("orgs.your_fingerprint")} <Fingerprint publicKey={identity.publicKey} />
            </p>
          </div>
          {org.role !== "owner" && me && (
            <Button
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
      </Card>

      <Card>
        <h2>{t("orgs.members")}</h2>
        <p className="row-hint">{t("orgs.fingerprint_hint")}</p>
        {members.map((member) => (
          <div className="org-row" key={member.accountId}>
            <span className="org-row-text">
              <strong>{member.email}</strong>
              <small>
                {t(ROLE_LABEL[member.role])} · <Fingerprint publicKey={member.publicKey} />
              </small>
            </span>
            {org.role === "owner" && member.role !== "owner" && (
              <select
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
            )}
            {member.role !== "owner" &&
              member.publicKey !== identity.publicKey &&
              (org.role === "owner" || (admin && member.role === "member")) && (
                <Button
                  onClick={() => {
                    if (confirm(t("orgs.remove_confirm", { email: member.email }))) {
                      void run(() => removeMember(org.id, member.accountId), "orgs.removed");
                    }
                  }}
                >
                  {t("orgs.remove")}
                </Button>
              )}
          </div>
        ))}
        {invites.map((invite) => (
          <div className="org-row pending" key={invite.id}>
            <span className="org-row-text">
              <strong>{invite.email}</strong>
              <small>
                {t("orgs.invited_until", {
                  role: t(ROLE_LABEL[invite.role]),
                  date: formatDateTime(invite.expiresAt, locale),
                })}
              </small>
            </span>
            <Button onClick={() => void run(() => withdrawInvite(org.id, invite.id))}>
              {t("orgs.withdraw")}
            </Button>
          </div>
        ))}
        {admin && (
          <form
            className="inline-form"
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
              }, "orgs.invited");
            }}
          >
            <input name="email" type="email" placeholder={t("orgs.invite_email")} required />
            <select name="role" aria-label={t("orgs.role")}>
              <option value="member">{t("orgs.role_member")}</option>
              {org.role === "owner" && <option value="admin">{t("orgs.role_admin")}</option>}
            </select>
            <Button variant="primary" type="submit">
              {t("orgs.invite")}
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <h2>{t("orgs.teams")}</h2>
        {teams.length === 0 && <p className="row-hint">{t("orgs.no_teams")}</p>}
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
        {admin && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = String(new FormData(form).get("name"));
              void run(async () => {
                await createTeam(org.id, name, identity);
                form.reset();
              }, "orgs.team_created");
            }}
          >
            <input name="name" maxLength={80} placeholder={t("orgs.team_name")} required />
            <Button variant="primary" type="submit">
              {t("orgs.create_team")}
            </Button>
          </form>
        )}
      </Card>

      {audit && (
        <Card>
          <h2>{t("orgs.audit")}</h2>
          <p className={audit.verified ? "row-hint ok-text" : "error"}>
            {t(audit.verified ? "orgs.audit_verified" : "orgs.audit_broken")}
          </p>
          {audit.events.slice(0, 30).map((event) => (
            <div className="audit-row" key={event.seq}>
              <span className="audit-time">{formatDateTime(event.at, locale)}</span>
              <span>
                <strong>{emailOf(event.actor)}</strong>{" "}
                {ACTION_LABEL[event.action] ? t(ACTION_LABEL[event.action]!) : event.action}
                {describeTarget(event)}
              </span>
              <span className="audit-ip">{event.ip ?? ""}</span>
            </div>
          ))}
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
        <strong>{team.name}</strong>
        <span className="row-hint">
          {t("orgs.team_members", { count: team.members.length })}
          {team.rekeyNeeded ? ` · ${t("orgs.rekey_needed")}` : ""}
        </span>
      </summary>
      {team.members.map((accountId) => (
        <div className="org-row" key={accountId}>
          <span className="org-row-text">
            <strong>{emailOf(accountId)}</strong>
          </span>
          {admin && (
            <Button onClick={() => void run(() => removeTeamMember(orgId, team.id, accountId))}>
              {t("orgs.remove")}
            </Button>
          )}
        </div>
      ))}
      {admin && team.wrappedKey && candidates.length > 0 && (
        <form
          className="inline-form"
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
        <Button
          className="quiet"
          onClick={() => {
            if (confirm(t("orgs.delete_team_confirm", { name: team.name }))) {
              void run(() => deleteTeam(orgId, team.id), "orgs.team_deleted");
            }
          }}
        >
          {t("orgs.delete_team")}
        </Button>
      )}
    </details>
  );
}
