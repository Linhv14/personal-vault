import { useState } from "preact/hooks";
import { rewrapVaultKey } from "../../../src/core/crypto.js";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import { getLocal, lock, setLocal } from "../../lib/storage.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { useT } from "../../ui/i18n.js";
import { vaultKeyRawSignal, vaultKeySignal } from "../../ui/store/session.js";
import { currentAuthKey, reloadLocal, showToast } from "../state.js";

export function Security() {
  const t = useT();
  const vaultKey = vaultKeySignal.value;
  const [changeError, setChangeError] = useState<string | null>(null);

  const handleChangePassword = async (event: Event) => {
    event.preventDefault();
    setChangeError(null);
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next = String(data.get("next"));
    const vaultKeyRaw = vaultKeyRawSignal.value;
    if (next !== String(data.get("confirm"))) {
      setChangeError(t("setup.password_mismatch"));
      return;
    }
    if (!vaultKeyRaw) {
      setChangeError(t("settings.locked_hint"));
      return;
    }
    const authKey = await currentAuthKey(String(data.get("current")));
    const { email } = await getLocal();
    if (!authKey || !email) {
      setChangeError(t("settings.wrong_current"));
      return;
    }
    try {
      const record = await rewrapVaultKey(email, next, vaultKeyRaw);
      await api.changePassword(authKey, record);
      await setLocal({ kdf: record.kdf, wrappedVaultKey: record.wrappedVaultKey });
      await lock();
      form.reset();
      showToast(t("settings.changed"));
      await reloadLocal();
    } catch (error) {
      setChangeError(describeError(error, t));
    }
  };

  return (
    <section className="page">
      <h1>{t("settings.section_security")}</h1>
      <Card>
        <h2>{t("settings.change_password")}</h2>
        <p className="row-hint">{t("settings.change_hint")}</p>
        {!vaultKey ? (
          <p className="notice">{t("settings.locked_hint")}</p>
        ) : (
          <form className="stack" onSubmit={(event) => void handleChangePassword(event)}>
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              placeholder={t("settings.current_password")}
              required
            />
            <input
              name="next"
              type="password"
              minLength={12}
              autoComplete="new-password"
              placeholder={t("settings.new_password")}
              required
            />
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              placeholder={t("setup.confirm")}
              required
            />
            {changeError && (
              <p className="error" role="alert">
                {changeError}
              </p>
            )}
            <Button variant="primary" type="submit">
              {t("settings.change_submit")}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}
