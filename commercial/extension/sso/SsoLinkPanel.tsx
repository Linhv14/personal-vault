import { useEffect, useRef, useState } from "preact/hooks";
import { describeError } from "#i18n/index.js";
import { formText } from "#ui/form-data.js";
import { ActionButton, Field, PanelHead } from "#ext/console/components.js";
import { useConsole } from "#ext/console/data.js";
import { currentAuthKey } from "#ext/lib/reauth.js";
import { toast } from "#ext/ui/store/feedback.js";
import { formatDateTime } from "#ext/ui/format.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { readLinkOutcome } from "#commercial/core/sso-model.js";
import { removeSsoLink, ssoLinkStatus, startSsoLink, type SsoLinkStatus } from "./api.js";
import { linkLauncher } from "./hosts.js";
import { outcomeMessage } from "./SsoSignIn.js";

const STACK = { display: "grid", gap: "12px" } as const;

export function SsoLinkPanel() {
  const t = useT();
  const { detail } = useConsole();
  const orgId = detail.org.id;
  const [status, setStatus] = useState<SsoLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    setStatus(null);
    ssoLinkStatus(orgId).then(setStatus, () => setStatus(null));
    return () => pending.current?.abort();
  }, [orgId]);

  if (!status || !status.available || status.onDomain) {
    return null;
  }
  const { twoFactor } = status;

  const link = async (form: HTMLFormElement) => {
    setError(null);
    setWorking(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const data = new FormData(form);
      const authKey = await currentAuthKey(formText(data, "current"));
      if (!authKey) {
        setError(t("settings.wrong_current"));
        return;
      }
      const launcher = linkLauncher();
      const authorizeUrl = await startSsoLink(orgId, {
        currentAuthKey: authKey,
        returnTo: launcher.returnTo,
        ...(twoFactor ? { code: formText(data, "code") } : {}),
      });
      const returned = await launcher.launch(authorizeUrl, controller.signal);
      const outcome = returned ? readLinkOutcome(returned) : null;
      if (outcome && "linked" in outcome) {
        toast(t("sso_link.linked"));
        setStatus(await ssoLinkStatus(orgId));
      } else if (!controller.signal.aborted) {
        setError(t(outcomeMessage(outcome?.error ?? "sso.failed")));
      }
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      pending.current = null;
      setWorking(false);
    }
  };

  const unlink = async () => {
    setError(null);
    try {
      setStatus(await removeSsoLink(orgId));
      toast(t("sso_link.unlinked"));
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  return (
    <section className="panel" id="sso-link">
      <PanelHead title={t("sso_link.title")} text={t("sso_link.text", { org: detail.org.name })} />
      {status.link ? (
        <div style={STACK}>
          <p>
            {t("sso_link.linked_at", {
              date: formatDateTime(status.link.linkedAt, localeSignal.value),
            })}
          </p>
          <div>
            <ActionButton className="btn danger" onClick={unlink}>
              {t("sso_link.unlink")}
            </ActionButton>
          </div>
        </div>
      ) : (
        <form
          style={STACK}
          onSubmit={(event) => {
            event.preventDefault();
            void link(event.currentTarget);
          }}
        >
          <Field label={t("settings.current_password")}>
            <input
              name="current"
              type="password"
              autoComplete="current-password"
              required
              disabled={working}
            />
          </Field>
          {twoFactor && (
            <Field label={t("twofa.prompt")}>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellcheck={false}
                required
                disabled={working}
              />
            </Field>
          )}
          {error && <p className="form-error">{error}</p>}
          {working && <p className="field-hint">{t("sso_link.waiting")}</p>}
          <div>
            {working ? (
              <button type="button" className="btn" onClick={() => pending.current?.abort()}>
                {t("sso_link.cancel")}
              </button>
            ) : (
              <button type="submit" className="btn primary">
                {t("sso_link.link")}
              </button>
            )}
          </div>
        </form>
      )}
      {status.link && error && <p className="form-error">{error}</p>}
    </section>
  );
}
