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

const MASK = "••••••••";

type Result = { url: string; meta: [IconName, string][]; passphrase: boolean };

type SharePart = {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  apply: (payload: SharePayload) => void;
};

function shareParts(item: VaultItem, t: ReturnType<typeof useT>): SharePart[] {
  const parts: SharePart[] = [];
  if (item.url) {
    const url = item.url;
    parts.push({
      key: "url",
      icon: "globe",
      label: t("common.url"),
      value: registrableDomain(url) ?? url,
      apply: (payload) => (payload.url = url),
    });
  }
  if (item.username) {
    const username = item.username;
    parts.push({
      key: "username",
      icon: "person",
      label: t("common.username"),
      value: username,
      apply: (payload) => (payload.username = username),
    });
  }
  if (item.password) {
    const password = item.password;
    parts.push({
      key: "password",
      icon: "key",
      label: t("common.password"),
      value: MASK,
      apply: (payload) => (payload.password = password),
    });
  }
  if (item.totp) {
    const totp = item.totp;
    parts.push({
      key: "totp",
      icon: "clock",
      label: t("common.totp"),
      value: "",
      apply: (payload) => (payload.totp = totp),
    });
  }
  (item.fields ?? []).forEach((field, index) => {
    if (!field.value) return;
    parts.push({
      key: `field-${index}`,
      icon: field.hidden ? "lock" : "tag",
      label: field.label || t("common.field"),
      value: field.hidden ? MASK : field.value,
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
      value: note.split("\n")[0] ?? "",
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

function SettingRow({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ComponentChildren;
}) {
  return (
    <label className="setting-row">
      <Icon name={icon} />
      <span className="setting-label">{label}</span>
      {children}
    </label>
  );
}

function Picker<T extends string>({
  name,
  value,
  choices,
  disabled = [],
  title,
  onChange,
}: {
  name: string;
  value: T;
  choices: [T, string][];
  disabled?: T[];
  title?: string;
  onChange: (value: T) => void;
}) {
  return (
    <select
      className="setting-select"
      name={name}
      value={value}
      title={title}
      onChange={(event) => onChange(event.currentTarget.value as T)}
    >
      {choices.map(([choice, text]) => (
        <option value={choice} key={choice} disabled={disabled.includes(choice)}>
          {text}
        </option>
      ))}
    </select>
  );
}

export function Share({ item, emailAccess }: { item: VaultItem; emailAccess: boolean }) {
  const t = useT();
  const entry = useRef<HTMLInputElement>(null);
  const [ttl, setTtl] = useState("86400");
  const [views, setViews] = useState<"1" | "unlimited">("1");
  const [access, setAccess] = useState<"anyone" | "emails">("anyone");
  const [locked, setLocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientsHint, setRecipientsHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set(["note"]));

  const parts = shareParts(item, t);
  const included = parts.filter((part) => !excluded.has(part.key));
  const restricted = emailAccess && access === "emails";
  const recipientCount = restricted ? recipients.length : 0;
  const allowOnce = singleViewAllowed(recipientCount);
  const maxViews = allowOnce ? views : "unlimited";

  const togglePart = (key: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
    const secret = (locked && passphrase.trim()) || undefined;
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
      const meta: [IconName, string][] = [
        ["clock", t("links.expires", { expiry: formatDate(created.expiresAt) })],
        ["eye", t(viewLimit === 1 ? "share.result_once" : "share.result_unlimited")],
      ];
      if (shareTo.length > 0) meta.push(["mail", t("links.restricted", { count: shareTo.length })]);
      setResult({ url, passphrase: Boolean(secret), meta });
      document.getElementById("screen-share")?.scrollTo({ top: 0 });
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  return (
    <section id="screen-share" className="screen">
      <header className="title-bar share-title">
        <IconButton id="share-back" icon="back" label={t("common.back")} onClick={showList} />
        <ItemIcon item={item} />
        <div className="title-text">
          <h1>{t("share.title")}</h1>
          <p>{item.title}</p>
        </div>
      </header>
      <form
        id="form-share"
        className="share-form"
        hidden={result !== null}
        onSubmit={(event) => void submit(event)}
      >
        <div
          className="share-group"
          id="share-fields"
          role="group"
          aria-label={t("share.contents")}
        >
          {parts.map((part) => {
            const on = !excluded.has(part.key);
            return (
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                key={part.key}
                className="share-part"
                onClick={() => togglePart(part.key)}
              >
                <Icon name={part.icon} className="share-part-icon" />
                <span className="share-part-label">{part.label}</span>
                {part.key === "totp" && (
                  <span
                    id="share-totp-hint"
                    className="share-part-warn"
                    title={t("share.totp_hint")}
                  >
                    <Icon name="alert" />
                  </span>
                )}
                <span className="share-part-value">{part.value}</span>
                <span className="share-check">{on && <Icon name="check" />}</span>
              </button>
            );
          })}
        </div>

        <div className="share-group">
          <SettingRow icon="clock" label={t("share.expires_in")}>
            <Picker
              name="ttl"
              value={ttl}
              choices={TTL_CHOICES.map(([value, label]) => [value, t(label)])}
              onChange={setTtl}
            />
          </SettingRow>
          <SettingRow icon="eye" label={t("share.max_views")}>
            <Picker
              name="maxViews"
              value={maxViews}
              title={allowOnce ? undefined : t("share.views_hint")}
              choices={[
                ["1", t("share.views_1")],
                ["unlimited", t("share.views_unlimited")],
              ]}
              disabled={allowOnce ? [] : ["1"]}
              onChange={setViews}
            />
          </SettingRow>
          {emailAccess && (
            <SettingRow icon="users" label={t("share.access")}>
              <Picker
                name="access"
                value={access}
                choices={[
                  ["anyone", t("share.access_anyone")],
                  ["emails", t("share.access_emails")],
                ]}
                onChange={(next) => {
                  setAccess(next);
                  if (next === "emails") setTimeout(() => entry.current?.focus());
                }}
              />
            </SettingRow>
          )}
          {restricted && (
            <div className="setting-extra" id="share-recipients-field">
              <div
                className="chip-input"
                id="share-recipients"
                aria-invalid={recipientsHint !== null}
                onClick={(event) => {
                  if (event.target === event.currentTarget) entry.current?.focus();
                }}
              >
                {recipients.map((email) => (
                  <span className="chip" key={email}>
                    <span className="chip-text">{email}</span>
                    <IconButton
                      icon="close"
                      label={t("share.remove_recipient", { email })}
                      onClick={() => {
                        setRecipients(recipients.filter((other) => other !== email));
                        entry.current?.focus();
                      }}
                    />
                  </span>
                ))}
                <input
                  id="share-recipient-entry"
                  ref={entry}
                  type="email"
                  autoComplete="off"
                  placeholder={t("share.recipients_placeholder")}
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
              </div>
              {recipientsHint && <small className="hint warn-text">{recipientsHint}</small>}
            </div>
          )}
          <SettingRow icon="lock" label={t("share.passphrase")}>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              name="locked"
              checked={locked}
              title={t("share.passphrase_hint")}
              onChange={(event) => setLocked(event.currentTarget.checked)}
            />
          </SettingRow>
          {locked && (
            <div className="setting-extra">
              <input
                name="passphrase"
                type="text"
                autoComplete="off"
                autoFocus
                aria-label={t("share.passphrase")}
                placeholder={t("share.passphrase")}
                value={passphrase}
                onInput={(event) => setPassphrase((event.currentTarget as HTMLInputElement).value)}
              />
            </div>
          )}
        </div>

        <div className="share-footer">
          <button className="primary" type="submit" disabled={included.length === 0}>
            <Icon name="link" />
            {t("share.create")}
          </button>
        </div>
      </form>
      <div id="share-result" className="share-result" hidden={result === null}>
        <div className="result-head">
          <span className="brand-mark">
            <Icon name="check" />
          </span>
          <h2>{t("share.ready")}</h2>
        </div>
        <div className="link-field">
          <input
            id="share-url"
            className="link-box"
            readOnly
            value={result?.url ?? ""}
            aria-label={t("share.link")}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (result) void copy(result.url, t("share.link").toLowerCase());
            }}
          >
            <Icon name="copy" />
            {t("share.copy_link")}
          </button>
        </div>
        <ul className="link-meta">
          {result?.meta.map(([icon, text]) => (
            <li key={text}>
              <Icon name={icon} />
              {text}
            </li>
          ))}
          {result?.passphrase && (
            <li className="warn" title={t("share.result_note_passphrase")}>
              <Icon name="lock" />
              {t("share.passphrase")}
            </li>
          )}
        </ul>
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
