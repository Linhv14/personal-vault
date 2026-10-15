import { useEffect, useState } from "preact/hooks";
import {
  LOCALE_NAMES,
  LOCALES,
  type LocalePreference,
  type Translate,
} from "../../../src/i18n/index.js";
import {
  autofillSupported,
  disableAutofill,
  enableAutofill,
  isAutofillEnabled,
} from "../../lib/autofill-permission.js";
import {
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTO_LOCK_MINUTES,
  getUnlocked,
  LOCK_NEVER,
  LOCK_ON_BROWSER_CLOSE,
  setLocal,
  touch,
} from "../../lib/storage.js";
import { rememberUnlock } from "../../lib/resume.js";
import { Card } from "../../ui/components/Card.js";
import { useT } from "../../ui/i18n.js";
import { localState, reloadLocal, showToast } from "../state.js";

function lockLabel(minutes: number, t: Translate): string {
  if (minutes === LOCK_ON_BROWSER_CLOSE) return t("settings.lock_on_close");
  if (minutes === LOCK_NEVER) return t("settings.lock_never");
  return minutes % 60 === 0
    ? t("settings.hours", { count: minutes / 60 })
    : t("settings.minutes", { count: minutes });
}

function lockOrder(minutes: number): number {
  if (minutes === LOCK_ON_BROWSER_CLOSE) return Number.MAX_SAFE_INTEGER - 1;
  if (minutes === LOCK_NEVER) return Number.MAX_SAFE_INTEGER;
  return minutes;
}

export function General() {
  const t = useT();
  const local = localState.value;
  const [autofill, setAutofill] = useState(false);

  useEffect(() => {
    void isAutofillEnabled().then(setAutofill);
  }, []);

  const handleLocale = async (value: string) => {
    await setLocal({ locale: value as LocalePreference });
    await reloadLocal();
  };

  const handleAutoLock = async (value: string) => {
    await setLocal({ autoLockMinutes: Number(value) });
    await touch();
    const session = await getUnlocked();
    if (session) await rememberUnlock(session.vaultKeyRaw, session.token);
    await reloadLocal();
    showToast(t("settings.saved"));
  };

  const handleLogos = async (enabled: boolean) => {
    await setLocal({ showLogos: enabled });
    await reloadLocal();
  };

  const handleAutofill = async (enabled: boolean) => {
    if (!enabled) {
      await disableAutofill();
      setAutofill(false);
      return;
    }
    const next = await enableAutofill();
    setAutofill(next);
    if (next) showToast(t("settings.autofill_enabled"));
  };

  const minutes = local.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES;
  const choices = AUTO_LOCK_CHOICES.includes(minutes)
    ? AUTO_LOCK_CHOICES
    : [...AUTO_LOCK_CHOICES, minutes].sort((a, b) => lockOrder(a) - lockOrder(b));

  return (
    <section className="page">
      <h1>{t("settings.section_preferences")}</h1>
      <Card className="rows">
        <label className="row">
          <span className="row-text">{t("settings.language")}</span>
          <select
            value={local.locale ?? "auto"}
            onChange={(event) =>
              void handleLocale((event.currentTarget as HTMLSelectElement).value)
            }
          >
            <option value="auto">{t("settings.language_auto")}</option>
            {LOCALES.map((code) => (
              <option value={code} key={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span className="row-text">
            <span>{t("settings.auto_lock")}</span>
            <span className="row-hint">{t("settings.auto_lock_hint")}</span>
          </span>
          <select
            value={String(minutes)}
            onChange={(event) =>
              void handleAutoLock((event.currentTarget as HTMLSelectElement).value)
            }
          >
            {choices.map((choice) => (
              <option value={choice} key={choice}>
                {lockLabel(choice, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <span className="row-text">
            <span>{t("settings.logos")}</span>
            <span className="row-hint">{t("settings.logos_hint")}</span>
          </span>
          <input
            className="switch"
            type="checkbox"
            checked={local.showLogos !== false}
            onChange={(event) =>
              void handleLogos((event.currentTarget as HTMLInputElement).checked)
            }
          />
        </label>
        {autofillSupported() && (
          <label className="row">
            <span className="row-text">
              <span>{t("settings.autofill")}</span>
              <span className="row-hint">{t("settings.autofill_hint")}</span>
            </span>
            <input
              className="switch"
              type="checkbox"
              checked={autofill}
              onChange={(event) =>
                void handleAutofill((event.currentTarget as HTMLInputElement).checked)
              }
            />
          </label>
        )}
      </Card>
    </section>
  );
}
