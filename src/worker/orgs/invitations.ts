import type { InvitableRole } from "#core/org-model.js";
import { orgInviteEmail, ownershipEmail } from "../emails.js";
import { createMailer } from "../mailer.js";
import type { Env } from "../types.js";
import { orgStore } from "../durable-objects.js";
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
  if (!mailer) {
    return false;
  }
  const [org, inviter] = await Promise.all([
    directory.org(invite.orgId),
    directory.emailOf(invite.invitedBy),
  ]);
  if (!org || !inviter) {
    return false;
  }
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
  if (!accepted || accepted === "domain") {
    return accepted;
  }
  await orgStore(env, accepted.orgId).setMember(
    invite.accountId,
    { accountId: invite.accountId, role: accepted.role },
    "member.joined",
    invite.ip,
  );
  await orgStore(env, accepted.orgId).claimInvite(invite.email, invite.accountId);
  return accepted.orgId;
}

export async function notifyNewOwner(
  env: Env,
  directory: OrgDirectory,
  transfer: { orgId: string; from: string; to: string; locale: "en" | "vi"; siteUrl: string },
): Promise<void> {
  const mailer = createMailer(env);
  if (!mailer) {
    return;
  }
  const [org, previous, recipient] = await Promise.all([
    directory.org(transfer.orgId),
    directory.emailOf(transfer.from),
    directory.emailOf(transfer.to),
  ]);
  if (!org || !previous || !recipient) {
    return;
  }
  const message = ownershipEmail(
    { locale: transfer.locale, siteUrl: transfer.siteUrl },
    {
      org: org.name,
      previous,
      link: `${transfer.siteUrl}/app/#/${transfer.orgId}/settings`,
    },
  );
  try {
    await mailer.send({ to: recipient, ...message });
  } catch {
    return;
  }
}
