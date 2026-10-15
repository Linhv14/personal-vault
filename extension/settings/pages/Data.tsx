import { useEffect, useState } from "preact/hooks";
import { describeError, type Translate } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import { scheduleClipboardClear } from "../../lib/clipboard.js";
import {
  forgetSharedLink,
  loadSharedLinks,
  saveSharedLinks,
  type SharedLink,
} from "../../lib/shared-links.js";
import { Card } from "../../ui/components/Card.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { formatDateTime } from "../../ui/format.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { vaultKeySignal } from "../../ui/store/session.js";
import { showToast } from "../state.js";

type LinkEntry = { link: SharedLink; status: api.ShareStatus };

export function Data() {
  const t = useT();
  const locale = localeSignal.value;
  const vaultKey = vaultKeySignal.value;
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);

  useEffect(() => {
    if (!vaultKey) return;
    let active = true;
    const load = async () => {
      setLinksError(null);
      try {
        const stored = await loadSharedLinks(vaultKey);
        const statuses = new Map(
          (await api.shareStatuses(stored.map(({ id, revokeToken }) => ({ id, revokeToken })))).map(
            (status) => [status.id, status],
          ),
        );
        const activeLinks = stored.filter((link) => statuses.get(link.id)?.active);
        if (activeLinks.length !== stored.length) await saveSharedLinks(vaultKey, activeLinks);
        if (active) {
          setLinks(
            activeLinks.flatMap((link) => {
              const status = statuses.get(link.id);
              return status ? [{ link, status }] : [];
            }),
          );
        }
      } catch (error) {
        if (active) setLinksError(describeError(error, t));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [vaultKey, locale]);

  const revokeLink = async (entry: LinkEntry) => {
    if (!vaultKey || !confirm(t("links.revoke_confirm", { title: entry.link.title }))) return;
    try {
      await api.revokeShareLink(entry.link.id, entry.link.revokeToken);
      await forgetSharedLink(vaultKey, entry.link.id);
      setLinks((current) => current.filter(({ link }) => link.id !== entry.link.id));
      showToast(t("links.revoked"));
    } catch (error) {
      setLinksError(describeError(error, t));
    }
  };

  const copyLink = async (link: SharedLink) => {
    await navigator.clipboard.writeText(link.url);
    await scheduleClipboardClear();
    showToast(t("common.copied", { what: t("share.link").toLowerCase() }));
  };

  return (
    <section className="page">
      <h1>{t("settings.section_data")}</h1>
      <Card className="rows">
        <div className="row">
          <span className="row-text">
            <span>{t("transfer.title")}</span>
            <span className="row-hint">{t("settings.import_hint")}</span>
          </span>
          <a className="button" href="../import/import.html">
            {t("settings.transfer_open")}
          </a>
        </div>
      </Card>
      <h2>{t("links.title")}</h2>
      <Card>
        {!vaultKey ? (
          <p className="notice">{t("settings.locked_hint")}</p>
        ) : (
          <>
            <div className="links">
              {links.map((entry) => (
                <LinkRow
                  entry={entry}
                  key={entry.link.id}
                  onCopy={() => void copyLink(entry.link)}
                  onRevoke={() => void revokeLink(entry)}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
            {links.length === 0 && <p className="row-hint">{t("links.empty")}</p>}
            {linksError && (
              <p className="error" role="alert">
                {linksError}
              </p>
            )}
            <p className="row-hint footnote">{t("links.only_this_device")}</p>
          </>
        )}
      </Card>
    </section>
  );
}

function LinkRow({
  entry,
  onCopy,
  onRevoke,
  t,
  locale,
}: {
  entry: LinkEntry;
  onCopy: () => void;
  onRevoke: () => void;
  t: Translate;
  locale: string;
}) {
  const { link, status } = entry;
  const views = status.active ? status.viewsLeft : null;
  return (
    <div className="link-row">
      <div className="link-text">
        <div className="link-title">{link.title}</div>
        <div className="row-hint">
          {[
            t("links.expires", {
              expiry: formatDateTime(status.active ? status.expiresAt : link.expiresAt, locale),
            }),
            ...(views === null ? [] : [t("links.views_left", { views })]),
            ...(link.recipients.length > 0
              ? [t("links.restricted", { count: link.recipients.length })]
              : []),
          ].join(" · ")}
        </div>
      </div>
      <IconButton icon="copy" label={t("links.copy")} onClick={onCopy} />
      <IconButton
        icon="link-off"
        className="danger-icon"
        label={t("links.revoke")}
        onClick={onRevoke}
      />
    </div>
  );
}
