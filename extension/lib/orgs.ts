import { utf8Encode } from "../../src/core/bytes.js";
import {
  fingerprint,
  randomKey,
  unwrapForRecipient,
  wrapForRecipient,
  type Identity,
  type WrappedForRecipient,
} from "../../src/core/identity.js";
import { request } from "./api.js";

export type OrgRole = "owner" | "admin" | "member";

export interface OrgSummary {
  id: string;
  name: string;
  plan: string;
  role: OrgRole;
}

export interface OrgMember {
  accountId: string;
  email: string;
  role: OrgRole;
  publicKey: string | null;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: number;
}

export interface Team {
  id: string;
  name: string;
  members: string[];
  rekeyNeeded: boolean;
  wrappedKey: WrappedForRecipient | null;
}

export interface OrgDetail {
  org: OrgSummary;
  members: OrgMember[];
  invites: OrgInvite[];
  teams: Team[];
}

export interface MyInvite {
  id: string;
  orgId: string;
  orgName: string;
  role: OrgRole;
  expiresAt: number;
}

export interface AuditEvent {
  seq: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
}

export function isOrgAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

function teamContext(teamId: string) {
  return utf8Encode(`personal-vault/team-key/${teamId}`);
}

const json = (body: unknown) => JSON.stringify(body);

export async function listOrgs(): Promise<OrgSummary[]> {
  return (await request<{ orgs: OrgSummary[] }>("/api/orgs")).orgs;
}

export async function createOrg(name: string): Promise<OrgSummary> {
  return request("/api/orgs", { method: "POST", body: json({ name }) });
}

export async function getOrg(orgId: string): Promise<OrgDetail> {
  return request(`/api/orgs/${orgId}`);
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: "admin" | "member",
  locale: string,
): Promise<void> {
  await request(`/api/orgs/${orgId}/invites`, {
    method: "POST",
    body: json({ email, role, locale }),
  });
}

export async function withdrawInvite(orgId: string, inviteId: string): Promise<void> {
  await request(`/api/orgs/${orgId}/invites/${inviteId}`, { method: "DELETE" });
}

export async function setMemberRole(
  orgId: string,
  accountId: string,
  role: "admin" | "member",
): Promise<void> {
  await request(`/api/orgs/${orgId}/members/${accountId}`, {
    method: "PATCH",
    body: json({ role }),
  });
}

export async function removeMember(orgId: string, accountId: string): Promise<void> {
  await request(`/api/orgs/${orgId}/members/${accountId}`, { method: "DELETE" });
}

export async function myInvites(): Promise<MyInvite[]> {
  return (await request<{ invites: MyInvite[] }>("/api/invites")).invites;
}

export async function acceptInvite(inviteId: string): Promise<string> {
  return (await request<{ orgId: string }>(`/api/invites/${inviteId}/accept`, { method: "POST" }))
    .orgId;
}

export async function declineInvite(inviteId: string): Promise<void> {
  await request(`/api/invites/${inviteId}`, { method: "DELETE" });
}

export async function createTeam(orgId: string, name: string, me: Identity): Promise<string> {
  const id = crypto.randomUUID();
  const wrappedKey = await wrapForRecipient(me.publicKey, randomKey(), teamContext(id));
  await request(`/api/orgs/${orgId}/teams`, {
    method: "POST",
    body: json({ id, name, wrappedKey }),
  });
  return id;
}

export async function teamKey(team: Team, me: Identity): Promise<Uint8Array> {
  if (!team.wrappedKey) throw new Error("not in team");
  return unwrapForRecipient(me, team.wrappedKey, teamContext(team.id));
}

export async function addTeamMember(
  orgId: string,
  team: Team,
  member: OrgMember,
  me: Identity,
): Promise<void> {
  if (!member.publicKey) throw new Error("member has no key yet");
  const key = await teamKey(team, me);
  const wrappedKey = await wrapForRecipient(
    member.publicKey,
    new Uint8Array(key),
    teamContext(team.id),
  );
  await request(`/api/orgs/${orgId}/teams/${team.id}/members/${member.accountId}`, {
    method: "PUT",
    body: json({ wrappedKey }),
  });
}

export async function removeTeamMember(
  orgId: string,
  teamId: string,
  accountId: string,
): Promise<void> {
  await request(`/api/orgs/${orgId}/teams/${teamId}/members/${accountId}`, { method: "DELETE" });
}

export async function deleteTeam(orgId: string, teamId: string): Promise<void> {
  await request(`/api/orgs/${orgId}/teams/${teamId}`, { method: "DELETE" });
}

export async function auditLog(
  orgId: string,
): Promise<{ events: AuditEvent[]; verified: boolean }> {
  return request(`/api/orgs/${orgId}/audit`);
}

export { fingerprint };
