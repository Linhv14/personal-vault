import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { useT } from "../../ui/i18n.js";
import { localState } from "../state.js";

export function Organization() {
  const t = useT();
  const apiUrl = localState.value.apiUrl?.replace(/\/$/, "");
  return (
    <section className="page">
      <h1>{t("orgs.title")}</h1>
      <Card>
        <h2>{t("console.entry_title")}</h2>
        <p className="row-hint">{t("console.entry_text")}</p>
        <div className="actions">
          <Button
            variant="primary"
            onClick={() =>
              void chrome.tabs.create({ url: chrome.runtime.getURL("console/console.html") })
            }
          >
            {t("console.open")}
          </Button>
          {apiUrl && (
            <a className="button quiet" href={`${apiUrl}/app/`} target="_blank" rel="noreferrer">
              {t("orgs.open_dashboard")}
            </a>
          )}
        </div>
      </Card>
    </section>
  );
}
