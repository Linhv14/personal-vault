import { formText } from "../../../src/ui/form-data.js";
import { createOrg } from "../../lib/orgs.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { Field, Spinner } from "../components.js";
import { pending$, type Run } from "../data.js";
import { navigate } from "../router.js";

export function WelcomePage({ run, error }: { run: Run; error: string | null }) {
  const t = useT();
  return (
    <section className="welcome">
      <h1>{t("orgs.create_title")}</h1>
      <p className="muted">{t("orgs.create_hint")}</p>
      <form
        className="panel welcome-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = formText(new FormData(event.currentTarget), "name").trim();
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
        <button
          type="submit"
          className="btn primary"
          disabled={pending$.value}
          aria-busy={pending$.value || undefined}
        >
          {pending$.value ? <Spinner /> : <Icon name="plus" />}
          {t("orgs.create")}
        </button>
      </form>
    </section>
  );
}
