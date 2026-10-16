import {
  fingerprint,
  randomKey,
  unwrapForRecipient,
  wrapForRecipient,
  type Identity,
} from "../../src/core/identity.js";
import {
  teamKeyContext,
  type AuditEvent,
  type InvitableRole,
  type OrgRole,
  type TeamView,
} from "../../src/core/org-model.js";
import type { Bytes } from "../../src/core/bytes.js";
import type { SealedData } from "../../src/core/crypto.js";
import { request } from "./api.js";
import { getLocal } from "./storage.js";

export { isOrgAdmin, planLimits } from "../../src/core/org-model.js";
export type { AuditEvent, OrgRole } from "../../src/core/org-model.js";
export type Team = TeamView;

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
  role: InvitableRole;
  expiresAt: number;
}

export interface OrgDetail {
  org: OrgSummary & { allowedDomains: string[] };
  members: OrgMember[];
  invites: OrgInvite[];
  teams: Team[];
  projects?: Record<string, TeamProjects>;
}

export interface TeamProjects {
  generation: number;
  projects: {
    id: string;
    sealed: SealedData;
    createdAt: number;
    secretCount: number;
    updatedAt: number;
  }[];
}

export interface MyInvite {
  id: string;
  orgId: string;
  orgName: string;
  role: InvitableRole;
  expiresAt: number;
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

export interface SentInvite {
  id: string;
  expiresAt: number;
  emailed: boolean;
  link: string;
}

export interface InvitePreview {
  orgName: string;
  inviter: string | null;
  email: string;
  role: InvitableRole;
  expiresAt: number;
  hasAccount: boolean;
  domainAllowed: boolean;
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: InvitableRole,
  locale: string,
): Promise<SentInvite> {
  return request(`/api/orgs/${orgId}/invites`, {
    method: "POST",
    body: json({ email, role, locale }),
  });
}

export async function previewInvite(inviteId: string): Promise<InvitePreview | null> {
  try {
    return await request<InvitePreview>(`/api/invites/${inviteId}/preview`, { auth: false });
  } catch {
    return null;
  }
}

export async function inviteLink(inviteId: string): Promise<string> {
  const { apiUrl = "" } = await getLocal();
  return `${apiUrl.replace(/\/$/, "")}/app/#/invite/${inviteId}`;
}

export async function withdrawInvite(orgId: string, inviteId: string): Promise<void> {
  await request(`/api/orgs/${orgId}/invites/${inviteId}`, { method: "DELETE" });
}

export async function setMemberRole(
  orgId: string,
  accountId: string,
  role: InvitableRole,
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
  const wrappedKey = await wrapForRecipient(me.publicKey, randomKey(), teamKeyContext(id, 0));
  await request(`/api/orgs/${orgId}/teams`, {
    method: "POST",
    body: json({ id, name, wrappedKey }),
  });
  return id;
}

export async function teamKey(team: Team, me: Identity): Promise<Bytes> {
  if (!team.wrappedKey) throw new Error("not in team");
  return new Uint8Array(
    await unwrapForRecipient(me, team.wrappedKey, teamKeyContext(team.id, team.generation)),
  );
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
    teamKeyContext(team.id, team.generation),
  );
  await request(`/api/orgs/${orgId}/teams/${team.id}/members/${member.accountId}`, {
    method: "PUT",
    body: json({ wrappedKey, generation: team.generation }),
  });
}

export async function transferOwnership(orgId: string, accountId: string): Promise<void> {
  await request(`/api/orgs/${orgId}/owner`, { method: "POST", body: json({ accountId }) });
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

export interface AuditPage {
  events: AuditEvent[];
  verified: boolean;
}

export async function auditLog(orgId: string, before?: number): Promise<AuditPage> {
  return request(`/api/orgs/${orgId}/audit${before ? `?before=${before}` : ""}`);
}

export { fingerprint };

export async function setAllowedDomains(orgId: string, domains: string[]): Promise<string[]> {
  return (
    await request<{ allowedDomains: string[] }>(`/api/orgs/${orgId}/domains`, {
      method: "PUT",
      body: json({ domains }),
    })
  ).allowedDomains;
}
