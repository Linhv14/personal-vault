import type { Context } from "hono";
import { HARD_LIMITS, isOrgAdmin, planLimits, type Principal } from "../../core/org-model.js";
import { apiError } from "../errors.js";
import { OrgDirectory } from "../orgs/directory.js";
import type { AppBindings } from "../types.js";
import { isUuid } from "../validate.js";

export type Ctx = Context<AppBindings>;
type MemberHandler = (c: Ctx, member: Principal, orgId: string) => Promise<Response>;

export const param = (c: Ctx, name: string) => c.req.param(name) ?? "";
export const directory = (c: Ctx) => new OrgDirectory(c.env.DB);
export const notFound = (c: Ctx) => c.json(apiError("orgs.not_found"), 404);
export const forbidden = (c: Ctx) => c.json(apiError("orgs.forbidden"), 403);
export const admins = (member: Principal) => isOrgAdmin(member.role);

export const isGeneration = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export async function limitsOf(c: Ctx, orgId: string) {
  const limits = planLimits((await directory(c).org(orgId))?.plan ?? "free");
  return {
    seats: limits.seats,
    teams: Math.min(limits.teams, HARD_LIMITS.teams),
    projects: Math.min(limits.projects, HARD_LIMITS.projects),
  };
}

export function asMember(
  handler: MemberHandler,
  rule: (member: Principal) => boolean = () => true,
) {
  return async (c: Ctx) => {
    const orgId = param(c, "orgId");
    if (!isUuid(orgId)) {
      return notFound(c);
    }
    const accountId = c.get("session").accountId;
    const role = await directory(c).roleOf(orgId, accountId);
    if (!role) {
      return notFound(c);
    }
    const member = { accountId, role };
    return rule(member) ? handler(c, member, orgId) : forbidden(c);
  };
}
