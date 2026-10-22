import { useEffect, useState } from "preact/hooks";
import type { IconName } from "../../../src/ui/icons.js";
import { describeError } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { formatDateTime, formatRelative } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { showToast } from "../state.js";

const KIND_ICONS: Record<api.SessionInfo["kind"], IconName> = {
  browser: "globe",
  cli: "terminal",
  ci: "braces",
  unknown: "globe",
};

export function SessionsCard() {
  const t = useT();
  const locale = localeSignal.value;
  const [sessions, setSessions] = useState<api.SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setSessions(await api.listSessions());
      setError(null);
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (session: api.SessionInfo) => {
    const label = session.label || t("settings.sessions_unknown_device");
    if (!confirm(t("settings.sessions_revoke_confirm", { device: label }))) {
      return;
    }
    try {
      await api.revokeSession(session.id);
      showToast(t("settings.sessions_revoked"));
      await load();
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  const revokeOthers = async () => {
    if (!confirm(t("settings.sessions_revoke_others_confirm"))) {
      return;
    }
    try {
      await api.revokeOtherSessions();
      showToast(t("settings.sessions_revoked_others"));
      await load();
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  if (!sessions && !error) {
    return null;
  }
  const others = (sessions ?? []).filter((session) => !session.current).length;

  return (
    <Card className="rows sessions">
      <div className="row">
        <h2>{t("settings.sessions")}</h2>
        {others > 0 && (
          <Button variant="danger" onClick={() => void revokeOthers()}>
            {t("settings.sessions_revoke_others")}
          </Button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(sessions ?? []).map((session) => {
        const active = session.lastSeenAt ?? session.createdAt;
        return (
          <div className="row" key={session.id}>
            <span className="session">
              <Icon name={KIND_ICONS[session.kind]} />
              <span className="row-text">
                <span>
                  {session.label || t("settings.sessions_unknown_device")}{" "}
                  {session.current && (
                    <span className="badge accent">{t("settings.sessions_this_device")}</span>
                  )}
                </span>
                <span className="row-hint" title={formatDateTime(active, locale)}>
                  {formatRelative(active, locale)}
                </span>
              </span>
            </span>
            {!session.current && (
              <IconButton
                icon="close"
                className="danger"
                label={t("settings.sessions_revoke")}
                onClick={() => void revoke(session)}
              />
            )}
          </div>
        );
      })}
    </Card>
  );
}
