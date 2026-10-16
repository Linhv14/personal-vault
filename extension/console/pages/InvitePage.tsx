import { useEffect, useState } from "preact/hooks";
import {
  acceptInvite,
  declineInvite,
  myInvites,
  previewInvite,
  type InvitePreview,
  type MyInvite,
} from "../../lib/orgs.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { ActionButton, Avatar, EmptyState, PageSkeleton } from "../components.js";
import type { Run } from "../data.js";
import { ROLE_LABEL } from "../labels.js";
import { navigate } from "../router.js";

export function InvitePage({
  inviteId,
  account,
  run,
}: {
  inviteId: string;
  account: string;
  run: Run;
}) {
  const t = useT();
  const [state, setState] = useState<
    { invite: MyInvite | undefined; preview: InvitePreview | null } | undefined
  >(undefined);

  useEffect(() => {
    setState(undefined);
    void Promise.all([myInvites(), previewInvite(inviteId)]).then(([mine, preview]) =>
      setState({ invite: mine.find((entry) => entry.id === inviteId), preview }),
    );
  }, [inviteId]);

  if (!state) return <PageSkeleton />;
  const { invite, preview } = state;
  const home = (
    <a className="btn" href="#/">
      {t("invite.go_console")}
    </a>
  );

  if (preview && !preview.domainAllowed) {
    return (
      <EmptyState
        icon="mail"
        title={t("invite.domain_title")}
        text={t("invite.domain_text", { org: preview.orgName })}
        action={home}
      />
    );
  }

  if (!invite) {
    if (!preview) {
      return (
        <EmptyState
          icon="mail"
          title={t("invite.gone_title")}
          text={t("invite.gone_text")}
          action={home}
        />
      );
    }
    return (
      <EmptyState
        icon="mail"
        title={t("invite.other_title", { org: preview.orgName })}
        text={t("invite.other_text", { email: preview.email, account })}
        action={home}
      />
    );
  }

  return (
    <section className="invite-card panel">
      <Avatar text={invite.orgName} size="lg" />
      <h1>{t("invite.title", { org: invite.orgName })}</h1>
      <dl className="invite-facts">
        <div>
          <dt>{t("orgs.role")}</dt>
          <dd>{t(ROLE_LABEL[invite.role])}</dd>
        </div>
        <div>
          <dt>{t("console.expires")}</dt>
          <dd>{formatDateTime(invite.expiresAt, localeSignal.value)}</dd>
        </div>
      </dl>
      <p className="muted">{t("invite.explain")}</p>
      <div className="invite-actions">
        <ActionButton
          className="btn primary"
          icon="check"
          onClick={() =>
            run(async () => {
              const orgId = await acceptInvite(invite.id);
              navigate(orgId, { page: "projects" });
            }, "orgs.joined")
          }
        >
          {t("orgs.accept")}
        </ActionButton>
        <ActionButton
          className="btn ghost"
          onClick={() =>
            run(async () => {
              await declineInvite(invite.id);
              location.hash = "#/";
            }, "orgs.declined")
          }
        >
          {t("orgs.decline")}
        </ActionButton>
      </div>
    </section>
  );
}
