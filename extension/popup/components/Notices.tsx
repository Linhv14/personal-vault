import { Icon } from "../../ui/components/Icon.js";
import { Logo } from "../../ui/components/Logo.js";
import { useT } from "../../ui/i18n.js";
import { IconButton } from "../../ui/components/IconButton.js";
import {
  autofillPromo,
  clockWarning,
  dismissAutofillPromo,
  syncing,
  syncProblem,
  turnOnAutofill,
} from "../state.js";

export function Notices() {
  const t = useT();
  const problem = syncProblem.value;
  return (
    <>
      <div className="sync-bar" hidden={!syncing.value} />
      {problem && (
        <p className={problem.kind === "failed" ? "notice-line failed" : "notice-line"}>
          <Icon name={problem.kind === "failed" ? "alert" : "cloud-off"} />
          {problem.message}
        </p>
      )}
      {clockWarning.value && <p className="notice-line warn">{clockWarning.value}</p>}
      {autofillPromo.value && (
        <div className="promo">
          <Logo size={22} />
          <span className="promo-text">{t("list.autofill_promo")}</span>
          <button className="link" onClick={() => void turnOnAutofill()}>
            {t("list.autofill_enable")}
          </button>
          <IconButton
            icon="close"
            label={t("common.close")}
            onClick={() => void dismissAutofillPromo()}
          />
        </div>
      )}
    </>
  );
}
