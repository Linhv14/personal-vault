import type { Translate } from "#i18n/index.js";
import { autofillSupported } from "#ext/lib/autofill-permission.js";
import { allowSaving, neverSaveSites, type NeverSaveSite } from "#ext/lib/never-save.js";
import { Card } from "#ext/ui/components/Card.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { useT } from "#ext/ui/i18n.js";
import { localState, reloadLocal } from "../state.js";

function turnedOff(site: NeverSaveSite, t: Translate): string {
  if (site.logins && site.forms) {
    return t("settings.never_save_both");
  }
  return t(site.logins ? "settings.never_save_logins" : "settings.never_save_forms");
}

export function NeverSaveCard() {
  const t = useT();
  const sites = neverSaveSites(localState.value);

  const allow = async (domain: string) => {
    await allowSaving(domain);
    await reloadLocal();
  };

  if (sites.length === 0 && !autofillSupported()) {
    return null;
  }

  return (
    <Card className="rows never-save">
      <div className="row">
        <span className="row-text">
          <h2>{t("settings.never_save")}</h2>
          <span className="row-hint">
            {t(sites.length > 0 ? "settings.never_save_hint" : "settings.never_save_empty")}
          </span>
        </span>
      </div>
      {sites.map((site) => (
        <div className="row" key={site.domain}>
          <span className="row-text">
            <span>{site.domain}</span>
            <span className="row-hint">{turnedOff(site, t)}</span>
          </span>
          <IconButton
            icon="close"
            label={t("settings.never_save_remove", { domain: site.domain })}
            onClick={() => void allow(site.domain)}
          />
        </div>
      ))}
    </Card>
  );
}
