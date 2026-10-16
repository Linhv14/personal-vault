import { useEffect, useState } from "preact/hooks";
import {
  acceptInvite,
  declineInvite,
  myInvites,
  previewInvite,
  type InvitePreview,
  type MyInvite,
} from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { Avatar, EmptyState } from "../components.js";
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

  if (!state) return <span className="spinner" />;
  const { invite, preview } = state;
  const home = (
    <a className="btn" href="#/">
      {t("invite.go_console")}
    </a>
  );

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
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            void run(async () => {
              const orgId = await acceptInvite(invite.id);
              navigate(orgId, { page: "projects" });
            }, "orgs.joined")
          }
        >
          <Icon name="check" />
          {t("orgs.accept")}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            void run(async () => {
              await declineInvite(invite.id);
              location.hash = "#/";
            })
          }
        >
          {t("orgs.decline")}
        </button>
      </div>
    </section>
  );
}
