import { useState } from "preact/hooks";
import { createOrg, planLimits, removeMember } from "../../lib/orgs.js";
import { Fingerprint } from "../../ui/components/Fingerprint.js";
import { useT } from "../../ui/i18n.js";
import { Dialog, Field, PageHeader, Usage } from "../components.js";
import { useConsole } from "../data.js";
import { ROLE_LABEL } from "../labels.js";
import { navigate } from "../router.js";

type Modal = "create" | "leave" | null;

export function SettingsPage() {
  const t = useT();
  const { detail, identity, projects, me, run } = useConsole();
  const [modal, setModal] = useState<Modal>(null);
  const { org, members, invites, teams } = detail;
  const limits = planLimits(org.plan);

  return (
    <>
      <PageHeader title={t("console.settings")} meta={org.name} />

      <section className="panel">
        <h2 className="panel-title">{t("console.plan")}</h2>
        <p className="panel-text">
          {t(org.plan === "team" ? "orgs.plan_team" : "orgs.plan_free")} ·{" "}
          {t("orgs.your_role", { role: t(ROLE_LABEL[org.role]) })}
        </p>
        <div className="usage-grid">
          <Usage
            label={t("console.seats")}
            used={members.length + invites.length}
            limit={limits.seats}
          />
          <Usage label={t("orgs.teams")} used={teams.length} limit={limits.teams} />
          <Usage label={t("projects.tab")} used={projects?.length ?? 0} limit={limits.projects} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">{t("console.your_key")}</h2>
        <p className="panel-text">{t("orgs.fingerprint_hint")}</p>
        <Fingerprint publicKey={identity.publicKey} />
      </section>

      <section className="panel">
        <h2 className="panel-title">{t("console.organizations")}</h2>
        <p className="panel-text">{t("orgs.create_hint")}</p>
        <button type="button" className="btn" onClick={() => setModal("create")}>
          {t("orgs.create_title")}
        </button>
      </section>

      {org.role !== "owner" && me && (
        <section className="panel danger-zone">
          <h2 className="panel-title">{t("orgs.leave")}</h2>
          <p className="panel-text">{t("orgs.leave_confirm", { name: org.name })}</p>
          <button type="button" className="btn danger" onClick={() => setModal("leave")}>
            {t("orgs.leave")}
          </button>
        </section>
      )}

      {modal === "create" && (
        <Dialog
          title={t("orgs.create_title")}
          description={t("orgs.create_hint")}
          submitLabel={t("orgs.create")}
          onClose={() => setModal(null)}
          onSubmit={(form) => {
            const name = String(new FormData(form).get("name")).trim();
            void run(async () => {
              const created = await createOrg(name);
              setModal(null);
              navigate(created.id, { page: "projects" });
            }, "orgs.created");
          }}
        >
          <Field label={t("orgs.name")}>
            <input name="name" maxLength={80} required autoFocus />
          </Field>
        </Dialog>
      )}
      {modal === "leave" && me && (
        <Dialog
          title={t("orgs.leave")}
          description={t("orgs.leave_confirm", { name: org.name })}
          submitLabel={t("orgs.leave")}
          danger
          onClose={() => setModal(null)}
          onSubmit={() =>
            void run(async () => {
              await removeMember(org.id, me.accountId);
              setModal(null);
              location.hash = "";
            }, "orgs.left")
          }
        />
      )}
    </>
  );
}
