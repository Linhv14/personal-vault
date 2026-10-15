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

export function teamKeyContext(teamId: string): Bytes {
  return utf8Encode(`personal-vault/team-key/${teamId}`);
}
