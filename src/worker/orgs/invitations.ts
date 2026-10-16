import type { InvitableRole } from "../../core/org-model.js";
import { orgInviteEmail } from "../emails.js";
import { createMailer } from "../mailer.js";
import type { Env } from "../types.js";
import { orgStore } from "../stores.js";
import type { OrgDirectory } from "./directory.js";

export function invitationLink(siteUrl: string, inviteId: string): string {
  return `${siteUrl}/app/#/invite/${inviteId}`;
}

export async function sendInvitation(
  env: Env,
  directory: OrgDirectory,
  invite: {
    id: string;
    orgId: string;
    email: string;
    role: InvitableRole;
    expiresAt: number;
    invitedBy: string;
    locale: "en" | "vi";
    siteUrl: string;
  },
): Promise<boolean> {
  const mailer = createMailer(env);
  if (!mailer) return false;
  const [org, inviter] = await Promise.all([
    directory.org(invite.orgId),
    directory.emailOf(invite.invitedBy),
  ]);
  if (!org || !inviter) return false;
  const message = orgInviteEmail(
    { locale: invite.locale, siteUrl: invite.siteUrl },
    {
      org: org.name,
      inviter,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      link: invitationLink(invite.siteUrl, invite.id),
    },
  );
  try {
    await mailer.send({ to: invite.email, ...message });
    return true;
  } catch {
    return false;
  }
}

export async function joinFromInvite(
  env: Env,
  directory: OrgDirectory,
  invite: { id: string; email: string; accountId: string; ip: string | null },
): Promise<string | null> {
  const accepted = await directory.accept(invite.id, invite.email, invite.accountId);
  if (!accepted) return null;
  await orgStore(env, accepted.orgId).setMember(
    invite.accountId,
    { accountId: invite.accountId, role: accepted.role },
    "member.joined",
    invite.ip,
  );
  return accepted.orgId;
}
