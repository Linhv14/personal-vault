import { utf8Encode, type Bytes } from "./bytes.js";
import type { WrappedForRecipient } from "./identity.js";

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export type InvitableRole = Exclude<OrgRole, "owner">;
export type WrappedKey = WrappedForRecipient;

export interface Principal {
  accountId: string;
  role: OrgRole;
}

export type TeamAccess = "edit" | "view";

export const isTeamAccess = (value: unknown): value is TeamAccess =>
  value === "edit" || value === "view";

export interface TeamView {
  id: string;
  name: string;
  members: string[];
  viewers: string[];
  invited?: { email: string; access: TeamAccess }[];
  pending?: { accountId: string; access: TeamAccess }[];
  generation: number;
  rekeyNeeded: boolean;
  wrappedKey: WrappedKey | null;
}

export type AuditEvent = {
  seq: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  hash: string;
};

export function isInvitableRole(value: unknown): value is InvitableRole {
  return value === "admin" || value === "member";
}

export function isOrgAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

export function canInvite(actor: OrgRole, role: InvitableRole): boolean {
  return role === "admin" ? actor === "owner" : isOrgAdmin(actor);
}

export function canChangeRoles(actor: OrgRole): boolean {
  return actor === "owner";
}

export function canRemove(actor: Principal, target: Principal): boolean {
  if (target.role === "owner") {
    return false;
  }
  if (actor.accountId === target.accountId) {
    return true;
  }
  return actor.role === "owner" || (actor.role === "admin" && target.role === "member");
}

export const MAX_ALLOWED_DOMAINS = 10;

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const domain = value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return DOMAIN.test(domain) ? domain : null;
}

export function parseDomains(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ALLOWED_DOMAINS) {
    return null;
  }
  const domains: string[] = [];
  for (const entry of value) {
    const domain = normalizeDomain(entry);
    if (!domain) {
      return null;
    }
    if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return domains;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export function isDomainAllowed(email: string, domains: readonly string[]): boolean {
  return domains.length === 0 || domains.includes(emailDomain(email));
}

export function teamKeyContext(teamId: string, generation: number): Bytes {
  const base = `personal-vault/team-key/${teamId}`;
  return utf8Encode(generation === 0 ? base : `${base}/${generation}`);
}

export interface PlanLimits {
  seats: number;
  teams: number;
  projects: number;
}

const FREE_PLAN: PlanLimits = { seats: 5, teams: Infinity, projects: Infinity };

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: FREE_PLAN,
  team: { seats: 500, teams: Infinity, projects: Infinity },
  enterprise: { seats: 10_000, teams: Infinity, projects: Infinity },
};

export const HARD_LIMITS = { teams: 200, projects: 1000 } as const;

export function planLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? FREE_PLAN;
}
