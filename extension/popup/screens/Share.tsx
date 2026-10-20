import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { buildShareUrl, createShare, type SharePayload } from "../../../src/core/share.js";
import type { IconName } from "../../../src/ui/icons.js";
import { describeError, type MessageKey } from "../../../src/i18n/index.js";
import * as api from "../../lib/api.js";
import { addRecipients, MAX_SHARE_RECIPIENTS, singleViewAllowed } from "../../lib/recipients.js";
import { rememberSharedLink } from "../../lib/shared-links.js";
import { getLocal } from "../../lib/storage.js";
import { registrableDomain, type VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { ItemIcon } from "../components/ItemIcons.js";
import { copy, formatDate, openSettings, showList, vaultKey } from "../state.js";

const TTL_CHOICES: [string, MessageKey][] = [
  ["3600", "share.ttl_1h"],
  ["86400", "share.ttl_24h"],
  ["604800", "share.ttl_7d"],
  ["2592000", "share.ttl_30d"],
];

type Result = { url: string; note: string; passphrase: boolean };

function Chip({
  icon,
  text,
  children,
}: {
  icon: "check" | "mail";
  text: string;
  children?: ComponentChildren;
}) {
  return (
    <span className="chip">
      <Icon name={icon} />
      <span className="chip-text">{text}</span>
      {children}
    </span>
  );
}

function Segmented<T extends string>({
  name,
  value,
  choices,
  disabled = [],
  onChange,
}: {
  name: string;
  value: T;
  choices: [T, string][];
  disabled?: T[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {choices.map(([choice, label]) => (
        <label className="tab" key={choice}>
          <input
            type="radio"
            name={name}
            value={choice}
            checked={value === choice}
            disabled={disabled.includes(choice)}
            onChange={() => onChange(choice)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

type SharePart = {
  key: string;
  icon: IconName;
  label: string;
  apply: (payload: SharePayload) => void;
};

function shareParts(item: VaultItem, t: ReturnType<typeof useT>): SharePart[] {
  const parts: SharePart[] = [];
  if (item.url) {
    const url = item.url;
    parts.push({
      key: "url",
      icon: "link",
      label: registrableDomain(url) ?? url,
      apply: (payload) => (payload.url = url),
    });
  }
  if (item.username) {
    const username = item.username;
    parts.push({
      key: "username",
      icon: "person",
      label: username,
      apply: (payload) => (payload.username = username),
    });
  }
  if (item.password) {
    const password = item.password;
    parts.push({
      key: "password",
      icon: "key",
      label: t("common.password"),
      apply: (payload) => (payload.password = password),
    });
  }
  if (item.totp) {
    const totp = item.totp;
    parts.push({
      key: "totp",
      icon: "shield",
      label: t("common.totp"),
      apply: (payload) => (payload.totp = totp),
    });
  }
  (item.fields ?? []).forEach((field, index) => {
    if (!field.value) return;
    parts.push({
      key: `field-${index}`,
      icon: field.hidden ? "lock" : "tag",
      label: field.label || t("common.field"),
      apply: (payload) => {
        payload.fields = [
          ...(payload.fields ?? []),
          { label: field.label, value: field.value, ...(field.hidden ? { hidden: true } : {}) },
        ];
      },
    });
  });
  if (item.note) {
    const note = item.note;
    parts.push({
      key: "note",
      icon: "note",
      label: t("common.note"),
      apply: (payload) => (payload.note = note),
    });
  }
  return parts;
}

export function sharePayload(item: VaultItem, parts: SharePart[]): SharePayload {
  const payload: SharePayload = { title: item.title };
  for (const part of parts) part.apply(payload);
  return payload;
}

export function Share({ item, emailAccess }: { item: VaultItem; emailAccess: boolean }) {
  const t = useT();
  const entry = useRef<HTMLInputElement>(null);
  const [ttl, setTtl] = useState("86400");
  const [views, setViews] = useState<"1" | "unlimited">("1");
  const [guards, setGuards] = useState<{ emails: boolean; passphrase: boolean }>({
    emails: false,
    passphrase: false,
  });
  const [passphrase, setPassphrase] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientsHint, setRecipientsHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const restricted = emailAccess && guards.emails;
  const recipientCount = restricted ? recipients.length : 0;
  const allowOnce = singleViewAllowed(recipientCount);
  const maxViews = allowOnce ? views : "unlimited";

  const commitEntry = (): { ok: boolean; recipients: string[] } => {
    const input = entry.current;
    if (!input || !input.value.trim()) return { ok: true, recipients };
    const update = addRecipients(recipients, input.value);
    input.value = update.rejected.join(", ");
    setRecipients(update.recipients);
    setRecipientsHint(
      update.rejected.length > 0
        ? t("share.recipients_invalid", { emails: update.rejected.join(", ") })
        : update.overflow
          ? t("share.recipients_full")
          : null,
    );
    return { ok: update.rejected.length === 0, recipients: update.recipients };
  };

  const parts = shareParts(item, t);
  const [excluded, setExcluded] = useState<Set<string>>(new Set(["note"]));
  const included = parts.filter((part) => !excluded.has(part.key));
  const togglePart = (key: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async (event: Event) => {
    event.preventDefault();
    setError(null);
    let shareTo: string[] = [];
    if (restricted) {
      const committed = commitEntry();
      if (!committed.ok) return;
      if (committed.recipients.length === 0) {
        setRecipientsHint(t("share.recipients_required"));
        entry.current?.focus();
        return;
      }
      shareTo = committed.recipients;
    }
    const secret = (guards.passphrase && passphrase.trim()) || undefined;
    const viewLimit = maxViews === "1" ? 1 : null;

    try {
      const { sealed, fragment } = await createShare(sharePayload(item, included), secret);
      const created = await api.createShareLink(sealed, {
        ttlSeconds: Number(ttl),
        maxViews: viewLimit,
        recipients: shareTo,
      });
      const { apiUrl } = await getLocal();
      const url = buildShareUrl(apiUrl ?? "", created.id, fragment);
      if (vaultKey.value) {
        await rememberSharedLink(vaultKey.value, {
          id: created.id,
          url,
          itemId: item.id,
          title: item.title,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: created.expiresAt,
          maxViews: viewLimit,
          recipients: shareTo,
          hasPassphrase: Boolean(secret),
          revokeToken: created.revokeToken,
        });
      }
      setResult({
        url,
        passphrase: Boolean(secret),
        note: [
          t("links.expires", { expiry: formatDate(created.expiresAt) }),
          t(viewLimit === 1 ? "share.result_once" : "share.result_unlimited"),
          ...(shareTo.length > 0 ? [t("links.restricted", { count: shareTo.length })] : []),
        ].join(" · "),
      });
      document.getElementById("screen-share")?.scrollTo({ top: 0 });
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  const hasTotp = included.some((part) => part.key === "totp");

  return (
    <section id="screen-share" className="screen">
      <header className="title-bar share-title">
        <IconButton id="share-back" icon="back" label={t("common.back")} onClick={showList} />
        <ItemIcon item={item} />
        <div className="title-text">
          <h1>{t("share.title")}</h1>
          <p>
            {[item.title, item.url ? (registrableDomain(item.url) ?? item.url) : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      <form
        id="form-share"
        className="share-form"
        hidden={result !== null}
        onSubmit={(event) => void submit(event)}
      >
        <section className="share-block" aria-labelledby="share-contents-label">
          <span className="field-label" id="share-contents-label">
            <span>{t("share.contents")}</span>
            <span className="counter">
              {included.length}/{parts.length}
            </span>
          </span>
          <div className="share-parts" id="share-fields">
            {parts.map((part) => (
              <button
                type="button"
                key={part.key}
                className="share-part"
                aria-pressed={!excluded.has(part.key)}
                title={part.label}
                onClick={() => togglePart(part.key)}
              >
                <Icon name={part.icon} />
                <span className="chip-text">{part.label}</span>
                {part.key === "totp" && (
                  <span className="share-part-warn" title={t("share.totp_hint")}>
                    <Icon name="alert" />
                  </span>
                )}
              </button>
            ))}
          </div>
          {hasTotp && (
            <small className="hint share-note" id="share-totp-hint">
              <Icon name="alert" />
              {t("share.totp_hint")}
            </small>
          )}
        </section>
        <section className="share-block share-options">
          <div className="share-option" role="group" aria-labelledby="share-ttl-label">
            <span className="option-label" id="share-ttl-label">
              <Icon name="clock" />
              {t("share.expires_in")}
            </span>
            <Segmented
              name="ttl"
              value={ttl}
              choices={TTL_CHOICES.map(([value, label]) => [value, t(label)])}
              onChange={setTtl}
            />
          </div>
          <div className="share-option" role="group" aria-labelledby="share-views-label">
            <span className="option-label" id="share-views-label">
              <Icon name="eye" />
              {t("share.max_views")}
            </span>
            <Segmented
              name="maxViews"
              value={maxViews}
              choices={[
                ["1", t("share.views_1")],
                ["unlimited", t("share.views_unlimited")],
              ]}
              disabled={allowOnce ? [] : ["1"]}
              onChange={setViews}
            />
          </div>
        </section>
        <section className="share-block">
          <div className="share-guards">
            {emailAccess && (
              <button
                type="button"
                className="share-guard"
                aria-pressed={guards.emails}
                onClick={() => {
                  setGuards({ ...guards, emails: !guards.emails });
                  if (!guards.emails) setTimeout(() => entry.current?.focus());
                }}
              >
                <Icon name="mail" />
                {guards.emails && recipients.length > 0
                  ? t("share.protection_emails", { count: recipients.length })
                  : t("share.access_emails")}
              </button>
            )}
            <button
              type="button"
              className="share-guard"
              aria-pressed={guards.passphrase}
              onClick={() => setGuards({ ...guards, passphrase: !guards.passphrase })}
            >
              <Icon name="lock" />
              {t("share.passphrase")}
            </button>
          </div>
          {restricted && (
            <div className="form-field" id="share-recipients-field">
              <div
                className="chip-input"
                id="share-recipients"
                aria-invalid={recipientsHint !== null}
                onClick={(event) => {
                  if (event.target === event.currentTarget) entry.current?.focus();
                }}
              >
                {recipients.map((email) => (
                  <Chip icon="mail" text={email} key={email}>
                    <IconButton
                      icon="close"
                      label={t("share.remove_recipient", { email })}
                      onClick={() => {
                        setRecipients(recipients.filter((other) => other !== email));
                        entry.current?.focus();
                      }}
                    />
                  </Chip>
                ))}
                <input
                  id="share-recipient-entry"
                  ref={entry}
                  type="email"
                  autoComplete="off"
                  placeholder={t("share.recipients_placeholder")}
                  title={t("share.recipients_label")}
                  aria-label={t("share.recipients_label")}
                  disabled={recipients.length >= MAX_SHARE_RECIPIENTS}
                  onKeyDown={(event) => {
                    if (["Enter", ",", ";", " "].includes(event.key)) {
                      event.preventDefault();
                      commitEntry();
                    } else if (
                      event.key === "Backspace" &&
                      event.currentTarget.value === "" &&
                      recipients.length > 0
                    ) {
                      setRecipients(recipients.slice(0, -1));
                    }
                  }}
                  onBlur={() => commitEntry()}
                  onPaste={() => setTimeout(commitEntry)}
                />
                <span className="counter">
                  {recipients.length}/{MAX_SHARE_RECIPIENTS}
                </span>
              </div>
              {recipientsHint && <small className="hint warn-text">{recipientsHint}</small>}
            </div>
          )}
          {guards.passphrase && (
            <input
              name="passphrase"
              type="text"
              autoComplete="off"
              autoFocus
              aria-label={t("share.passphrase")}
              placeholder={t("share.passphrase_placeholder")}
              title={t("share.passphrase_hint")}
              value={passphrase}
              onInput={(event) => setPassphrase((event.currentTarget as HTMLInputElement).value)}
            />
          )}
        </section>
        <div className="share-footer">
          <button className="primary" type="submit" disabled={included.length === 0}>
            <Icon name="link" />
            {t("share.create_count", { count: included.length })}
          </button>
        </div>
      </form>
      <div id="share-result" className="share-result" hidden={result === null}>
        <div className="result-head">
          <span className="brand-mark">
            <Icon name="check" />
          </span>
          <h2>{t("share.ready")}</h2>
          <p className="hint">{result?.note}</p>
        </div>
        <input
          id="share-url"
          className="link-box"
          readOnly
          value={result?.url ?? ""}
          title={t("share.link")}
          aria-label={t("share.link")}
        />
        <button
          className="primary"
          onClick={() => {
            if (result) void copy(result.url, t("share.link").toLowerCase());
          }}
        >
          {t("share.copy_link")}
        </button>
        {result?.passphrase && (
          <p className="notice">
            <Icon name="lock" />
            <span>{t("share.result_note_passphrase")}</span>
          </p>
        )}
        <div className="screen-footer">
          <button type="button" className="link quiet" onClick={() => openSettings("data")}>
            {t("share.manage")}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
