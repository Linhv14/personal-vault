import { createOrg } from "../../lib/orgs.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { useT } from "../../ui/i18n.js";
import type { Run } from "./context.js";

export function CreateOrgCard({ run }: { run: Run }) {
  const t = useT();
  return (
    <Card>
      <h2>{t("orgs.create_title")}</h2>
      <p className="row-hint">{t("orgs.create_hint")}</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name"));
          void run(() => createOrg(name), "orgs.created");
        }}
      >
        <input name="name" maxLength={80} placeholder={t("orgs.name")} required />
        <Button variant="primary" type="submit">
          {t("orgs.create")}
        </Button>
      </form>
    </Card>
  );
}
