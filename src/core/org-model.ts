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

export interface TeamView {
  id: string;
  name: string;
  members: string[];
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

export function isOrgRole(value: unknown): value is OrgRole {
  return ORG_ROLES.includes(value as OrgRole);
}

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
  if (target.role === "owner") return false;
  if (actor.accountId === target.accountId) return true;
  return actor.role === "owner" || (actor.role === "admin" && target.role === "member");
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

const FREE_PLAN: PlanLimits = { seats: 5, teams: 3, projects: 5 };

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: FREE_PLAN,
  team: { seats: 500, teams: 200, projects: 1000 },
};

export function planLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? FREE_PLAN;
}
