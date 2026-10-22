import type { OrgRole, Principal, TeamAccess } from "../../core/org-model.js";
import { fail, ok, type Result } from "../http.js";
import { confirmedAdmin, type OrgContext } from "./context.js";

export async function setMember(
  org: OrgContext,
  actor: string,
  member: { accountId: string; role: OrgRole },
  action: string,
  ip: string | null,
): Promise<void> {
  org.teams.putMember(member.accountId, member.role);
  await org.audit.record(actor, action, member.accountId, ip);
}

export async function removeMember(
  org: OrgContext,
  actor: string,
  accountId: string,
  ip: string | null,
): Promise<void> {
  const teams = org.teams.teamsOfAccount(accountId);
  org.storage.transactionSync(() => {
    for (const teamId of teams) {
      org.teams.flagRekey(teamId);
    }
    org.teams.removeAccount(accountId);
  });
  await org.audit.record(actor, "member.removed", accountId, ip);
}

export async function transferOwnership(
  org: OrgContext,
  owner: string,
  successor: string,
  ip: string | null,
): Promise<void> {
  org.storage.transactionSync(() => {
    org.teams.transferOwnership(owner, successor);
  });
  await org.audit.record(owner, "org.owner_transferred", successor, ip);
}

export async function planInvite(
  org: OrgContext,
  principal: Principal,
  email: string,
  teams: { teamId: string; access: TeamAccess }[],
): Promise<Result<{ ok: true }>> {
  if (!confirmedAdmin(org, principal)) {
    return fail(403, "orgs.forbidden");
  }
  if (!teams.every(({ teamId }) => org.teams.exists(teamId))) {
    return fail(400, "orgs.invalid_team");
  }
  org.storage.transactionSync(() => {
    org.teams.replaceInvites(email, teams);
  });
  return ok({ ok: true as const });
}

export async function claimInvite(
  org: OrgContext,
  email: string,
  accountId: string,
): Promise<void> {
  org.storage.transactionSync(() => {
    org.teams.grantInvites(email, accountId);
    org.teams.forgetInvites(email);
  });
}
