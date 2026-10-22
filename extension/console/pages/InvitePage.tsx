import { useEffect, useState } from "preact/hooks";
import {
  acceptInvite,
  declineInvite,
  myInvites,
  previewInvite,
  type InvitePreview,
  type MyInvite,
} from "#ext/lib/orgs.js";
import { formatDateTime } from "#ext/ui/format.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { ActionButton, EmptyState, PageHeader, PageSkeleton, RoleBadge } from "../components.js";
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

  if (!state) {
    return <PageSkeleton />;
  }
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
    <>
      <PageHeader
        title={t("invite.title", { org: invite.orgName })}
        meta={
          preview?.inviter
            ? t("invite.lead", { inviter: preview.inviter, role: t(ROLE_LABEL[invite.role]) })
            : t("invite.lead_anonymous", { role: t(ROLE_LABEL[invite.role]) })
        }
      />
      <section className="panel narrow">
        <dl className="facts">
          <div>
            <dt>{t("orgs.role")}</dt>
            <dd>
              <RoleBadge role={invite.role} />
            </dd>
          </div>
          <div>
            <dt>{t("invite.for")}</dt>
            <dd>{account}</dd>
          </div>
          <div>
            <dt>{t("console.expires")}</dt>
            <dd>{formatDateTime(invite.expiresAt, localeSignal.value)}</dd>
          </div>
        </dl>
        <p className="panel-note">{t("invite.explain")}</p>
        <footer className="panel-foot">
          <ActionButton
            className="btn primary"
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
            className="btn"
            onClick={() =>
              run(async () => {
                await declineInvite(invite.id);
                location.hash = "#/";
              }, "orgs.declined")
            }
          >
            {t("orgs.decline")}
          </ActionButton>
        </footer>
      </section>
    </>
  );
}
