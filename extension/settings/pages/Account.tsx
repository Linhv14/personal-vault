import { useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import { clearAccountData, getLocal, lock } from "../../lib/storage.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { currentAuthKey, isSignedIn, localState, reloadLocal, showToast } from "../state.js";

export function Account() {
  const t = useT();
  const locale = localeSignal.value;
  const local = localState.value;
  const signedIn = isSignedIn(local);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleLogout = async () => {
    if (!confirm(t("settings.logout_confirm"))) return;
    await api.logout().catch(() => null);
    await clearAccountData();
    await lock();
    await reloadLocal();
  };

  const handleDelete = async (event: Event) => {
    event.preventDefault();
    setDeleteError(null);
    const form = event.currentTarget as HTMLFormElement;
    const authKey = await currentAuthKey(String(new FormData(form).get("current")));
    const { email } = await getLocal();
    if (!authKey) {
      setDeleteError(t("settings.wrong_current"));
      return;
    }
    if (!confirm(t("settings.delete_confirm", { email: email ?? "" }))) return;
    try {
      await api.deleteAccount(authKey);
      await clearAccountData();
      await lock();
      form.reset();
      await reloadLocal();
      showToast(t("settings.deleted"));
    } catch (error) {
      setDeleteError(describeError(error, t));
    }
  };

  return (
    <section className="page">
      <h1>{t("settings.section_account")}</h1>
      <Card className="rows">
        <div className="row">
          <span>{t("settings.account_email")}</span>
          <span className="value">{local.email ?? ""}</span>
        </div>
        <div className="row">
          <span>{t("settings.server")}</span>
          <span className="value">{local.apiUrl ? new URL(local.apiUrl).host : ""}</span>
        </div>
        <div className="row">
          <span>{t("settings.item_count")}</span>
          <span className="value">
            {
              (local.items ?? []).filter((item) => item.deletedAt === null && item.ciphertext)
                .length
            }
          </span>
        </div>
        <div className="row">
          <span>{t("settings.last_sync")}</span>
          <span className="value">
            {local.lastSync ? formatDateTime(local.lastSync, locale) : t("settings.never_synced")}
          </span>
        </div>
        {signedIn && (
          <div className="row">
            <span className="row-text">
              <span>{t("settings.logout")}</span>
              <span className="row-hint">{t("settings.logout_hint")}</span>
            </span>
            <Button onClick={() => void handleLogout()}>{t("settings.logout_short")}</Button>
          </div>
        )}
      </Card>
      <h2 className="danger-title">{t("settings.danger_zone")}</h2>
      {signedIn && (
        <Card className="danger-card">
          <h3>{t("settings.delete_account")}</h3>
          <p className="row-hint">{t("settings.delete_hint")}</p>
          <form className="stack" onSubmit={(event) => void handleDelete(event)}>
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              placeholder={t("settings.current_password")}
              required
            />
            {deleteError && (
              <p className="error" role="alert">
                {deleteError}
              </p>
            )}
            <Button variant="danger" type="submit">
              {t("settings.delete_submit")}
            </Button>
          </form>
        </Card>
      )}
      <p className="about">
        <span>7key v{chrome.runtime.getManifest().version}</span> ·{" "}
        {local.apiUrl && (
          <a href={`${local.apiUrl.replace(/\/$/, "")}/privacy`} target="_blank" rel="noopener">
            {t("settings.privacy")}
          </a>
        )}
      </p>
    </section>
  );
}
