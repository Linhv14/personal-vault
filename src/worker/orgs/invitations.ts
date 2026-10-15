import { orgInviteEmail } from "../emails.js";
import { createMailer } from "../mailer.js";
import type { Env } from "../types.js";
import type { OrgDirectory } from "./directory.js";

export async function sendInvitation(
  env: Env,
  directory: OrgDirectory,
  invite: { orgId: string; email: string; invitedBy: string; locale: "en" | "vi"; siteUrl: string },
): Promise<void> {
  const mailer = createMailer(env);
  if (!mailer) return;
  const [org, inviter] = await Promise.all([
    directory.org(invite.orgId),
    directory.emailOf(invite.invitedBy),
  ]);
  if (!org || !inviter) return;
  const message = orgInviteEmail(
    { locale: invite.locale, siteUrl: invite.siteUrl },
    org.name,
    inviter,
  );
  await mailer.send({ to: invite.email, ...message }).catch(() => {});
}
