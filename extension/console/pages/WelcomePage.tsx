import { createOrg } from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { Field } from "../components.js";
import type { Run } from "../data.js";
import { navigate } from "../router.js";

const STEPS = ["console.step_org", "console.step_team", "console.step_project"] as const;

export function WelcomePage({ run, error }: { run: Run; error: string | null }) {
  const t = useT();
  return (
    <section className="welcome">
      <h1>{t("orgs.create_title")}</h1>
      <p className="muted">{t("orgs.create_hint")}</p>
      <ol className="steps">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="step-index">{index + 1}</span>
            {t(step)}
          </li>
        ))}
      </ol>
      <form
        className="panel welcome-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name")).trim();
          void run(async () => {
            const created = await createOrg(name);
            navigate(created.id, { page: "projects" });
          }, "orgs.created");
        }}
      >
        <Field label={t("orgs.name")}>
          <input name="name" maxLength={80} required autoFocus placeholder="Acme Inc" />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn primary">
          <Icon name="plus" />
          {t("orgs.create")}
        </button>
      </form>
    </section>
  );
}
