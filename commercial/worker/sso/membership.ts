import { emailDomain, isDomainAllowed, planLimits } from "#core/org-model.js";
import type { AuthExtensions, RequestScope } from "#worker/auth-extensions.js";
import { now } from "#worker/clock.js";
import { orgStore } from "#worker/durable-objects.js";
import { OrgDirectory } from "#worker/orgs/directory.js";
import { joinFromInvite } from "#worker/orgs/invitations.js";
import { hashToken } from "#worker/session.js";
import { licensedSeats, ssoAvailable } from "./availability.js";
import { SsoStore } from "./store.js";

export type JoinOutcome =
  { orgId: string } | { refused: "orgs.single_org" | "orgs.seat_limit" | "sso.email_not_allowed" };

async function availableFor(scope: RequestScope, orgId: string): Promise<boolean> {
  const org = await new SsoStore(scope.env.DB).orgPlan(orgId);
  return org !== null && ssoAvailable(scope.env, scope.url, org.plan);
}

async function joinBlocked(
  scope: RequestScope,
  accountId: string,
  targetOrgId: string,
): Promise<boolean> {
  const store = new SsoStore(scope.env.DB);
  const memberships = await store.memberships(accountId);
  const others = memberships.filter((entry) => entry.orgId !== targetOrgId);
  if (others.length === 0) {
    return false;
  }
  for (const other of others) {
    if (other.singleOrg && other.role === "member" && (await availableFor(scope, other.orgId))) {
      return true;
    }
  }
  const target = await store.config(targetOrgId);
  return Boolean(target?.singleOrg) && (await availableFor(scope, targetOrgId));
}

async function seatLimit(scope: RequestScope, plan: string): Promise<number> {
  return Math.max(planLimits(plan).seats, await licensedSeats(scope.env, scope.url));
}

export async function joinOrg(
  scope: RequestScope,
  member: { orgId: string; accountId: string; email: string; ip: string },
): Promise<JoinOutcome> {
  const directory = new OrgDirectory(scope.env.DB);
  const { orgId, accountId, email, ip } = member;
  if (await directory.roleOf(orgId, accountId)) {
    return { orgId };
  }
  if (await joinBlocked(scope, accountId, orgId)) {
    return { refused: "orgs.single_org" };
  }
  const store = new SsoStore(scope.env.DB);
  const inviteId = await store.pendingInvite(orgId, email);
  if (inviteId) {
    const joined = await joinFromInvite(scope.env, directory, {
      id: inviteId,
      email,
      accountId,
      ip,
      url: scope.url,
    });
    if (joined === "policy") {
      return { refused: "orgs.single_org" };
    }
    if (joined && joined !== "domain") {
      return { orgId: joined };
    }
  }
  const org = await directory.org(orgId);
  if (
    !org ||
    !(await store.verifiedDomainOf(orgId, emailDomain(email))) ||
    !isDomainAllowed(email, org.allowedDomains)
  ) {
    return { refused: "sso.email_not_allowed" };
  }
  if ((await directory.seatsTaken(orgId, email)) >= (await seatLimit(scope, org.plan))) {
    return { refused: "orgs.seat_limit" };
  }
  await scope.env.DB.prepare(
    `INSERT INTO org_members (org_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)
     ON CONFLICT(org_id, account_id) DO NOTHING`,
  )
    .bind(orgId, accountId, now())
    .run();
  await orgStore(scope.env, orgId).setMember(
    accountId,
    { accountId, role: "member" },
    "member.joined_sso",
    ip,
  );
  return { orgId };
}

export const ssoAuthExtensions: AuthExtensions = {
  async passwordSignInBlock(scope, accountId) {
    const required = await new SsoStore(scope.env.DB).requiredSsoFor(accountId);
    for (const entry of required) {
      if (await availableFor(scope, entry.orgId)) {
        return { identifier: entry.identifier ?? "" };
      }
    }
    return null;
  },

  orgJoinBlocked: joinBlocked,

  async externalRegistration(scope, grant) {
    const store = new SsoStore(scope.env.DB);
    const claim = await store.takeGrant(await hashToken(grant), "register");
    if (!claim || !(await availableFor(scope, claim.orgId))) {
      return null;
    }
    return {
      email: claim.email,
      join: async (accountId, ip) => {
        const outcome = await joinOrg(scope, {
          orgId: claim.orgId,
          accountId,
          email: claim.email,
          ip,
        });
        return "orgId" in outcome ? outcome.orgId : null;
      },
    };
  },
};
