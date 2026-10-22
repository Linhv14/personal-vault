import { useEffect, useState } from "preact/hooks";
import { formText } from "#ui/form-data.js";
import { describeError } from "#i18n/index.js";
import * as api from "#ext/lib/api.js";
import { isDefaultServer } from "#ext/lib/server.js";
import { clearAccountData, getLocal, lock } from "#ext/lib/storage.js";
import { Button } from "#ext/ui/components/Button.js";
import { Card } from "#ext/ui/components/Card.js";
import { formatDateTime } from "#ext/ui/format.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { vaultKeySignal } from "#ext/ui/store/session.js";
import { SessionsCard } from "./Sessions.js";
import { currentAuthKey, isSignedIn, localState, reloadLocal, showToast } from "../state.js";

export function Account() {
  const t = useT();
  const locale = localeSignal.value;
  const local = localState.value;
  const signedIn = isSignedIn(local);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [privacyUrl, setPrivacyUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPrivacyUrl(null);
    if (local.apiUrl) {
      void api.serverConfig(local.apiUrl).then((config) => {
        if (active) {
          setPrivacyUrl(config.privacyUrl ?? null);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [local.apiUrl]);

  const handleLogout = async () => {
    if (!confirm(t("settings.logout_confirm"))) {
      return;
    }
    await api.logout().catch(() => null);
    await clearAccountData();
    await lock();
    await reloadLocal();
  };

  const handleDelete = async (event: Event) => {
    event.preventDefault();
    setDeleteError(null);
    const form = event.currentTarget as HTMLFormElement;
    const authKey = await currentAuthKey(formText(new FormData(form), "current"));
    const { email } = await getLocal();
    if (!authKey) {
      setDeleteError(t("settings.wrong_current"));
      return;
    }
    if (!confirm(t("settings.delete_confirm", { email: email ?? "" }))) {
      return;
    }
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
        {local.apiUrl && !isDefaultServer(local.apiUrl) && (
          <div className="row">
            <span>{t("settings.server")}</span>
            <span className="value">{new URL(local.apiUrl).host}</span>
          </div>
        )}
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
      {signedIn && vaultKeySignal.value && <SessionsCard />}
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
        <span>7key v{chrome.runtime.getManifest().version}</span>
        {privacyUrl && (
          <>
            {" · "}
            <a href={privacyUrl} target="_blank" rel="noopener">
              {t("settings.privacy")}
            </a>
          </>
        )}
      </p>
    </section>
  );
}
