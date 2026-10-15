import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { buildShareUrl, createShare } from "../../../src/core/share.js";
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

export function Share({ item, emailAccess }: { item: VaultItem; emailAccess: boolean }) {
  const t = useT();
  const entry = useRef<HTMLInputElement>(null);
  const [ttl, setTtl] = useState("86400");
  const [views, setViews] = useState<"1" | "unlimited">("1");
  const [access, setAccess] = useState<"anyone" | "emails">("anyone");
  const [passphrase, setPassphrase] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientsHint, setRecipientsHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const restricted = emailAccess && access === "emails";
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
    const secret = passphrase.trim() || undefined;
    const viewLimit = maxViews === "1" ? 1 : null;

    try {
      const { sealed, fragment } = await createShare(
        {
          title: item.title,
          url: item.url,
          username: item.username,
          password: item.password,
          totp: item.totp,
        },
        secret,
      );
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

  const protections = [
    ...(restricted && recipientCount > 0
      ? [t("share.protection_emails", { count: recipientCount })]
      : []),
    ...(passphrase.trim() ? [t("share.protection_passphrase")] : []),
  ];

  const sharedFields: [unknown, MessageKey][] = [
    [item.url, "common.url"],
    [item.username, "common.username"],
    [item.password, "common.password"],
    [item.totp, "common.totp"],
  ];

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
        className="stack"
        hidden={result !== null}
        onSubmit={(event) => void submit(event)}
      >
        <section className="share-contents" aria-labelledby="share-contents-label">
          <span className="field-label" id="share-contents-label">
            {t("share.contents")}
          </span>
          <p className="share-includes" id="share-fields">
            <Icon name="check" />
            {sharedFields
              .filter(([value]) => Boolean(value))
              .map(([, key]) => t(key))
              .join(" · ")}
          </p>
          <small className="hint share-note" id="share-totp-hint" hidden={!item.totp}>
            <Icon name="alert" />
            {t("share.totp_hint")}
          </small>
        </section>
        <div className="option-row" role="group" aria-labelledby="share-ttl-label">
          <span className="option-label" id="share-ttl-label">
            {t("share.expires_in")}
          </span>
          <Segmented
            name="ttl"
            value={ttl}
            choices={TTL_CHOICES.map(([value, label]) => [value, t(label)])}
            onChange={setTtl}
          />
        </div>
        <div className="option-row" role="group" aria-labelledby="share-views-label">
          <span className="option-label" id="share-views-label">
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
          <small className="hint option-hint" id="share-views-hint" hidden={allowOnce}>
            {t("share.views_hint")}
          </small>
        </div>
        <details
          className="disclosure"
          onToggle={(event) => {
            const details = event.currentTarget as HTMLDetailsElement;
            if (details.open) details.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
        >
          <summary>
            <span>{t("share.protection")}</span>
            <span className="disclosure-state">{protections.join(" · ")}</span>
          </summary>
          <div className="stack">
            {emailAccess && (
              <fieldset className="choice-group">
                <legend>{t("share.access")}</legend>
                <Segmented
                  name="access"
                  value={access}
                  choices={[
                    ["anyone", t("share.access_anyone")],
                    ["emails", t("share.access_emails")],
                  ]}
                  onChange={setAccess}
                />
              </fieldset>
            )}
            <div className="form-field" id="share-recipients-field" hidden={!restricted}>
              <span className="field-label">
                <span>{t("share.recipients_label")}</span>
                <span className="counter">
                  {recipients.length}/{MAX_SHARE_RECIPIENTS}
                </span>
              </span>
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
              </div>
              <small className={recipientsHint ? "hint warn-text" : "hint"}>
                {recipientsHint ?? t("share.recipients_hint")}
              </small>
            </div>
            <label>
              <span>{t("share.passphrase")}</span>
              <input
                name="passphrase"
                type="text"
                autoComplete="off"
                placeholder={t("share.passphrase_placeholder")}
                value={passphrase}
                onInput={(event) => setPassphrase((event.currentTarget as HTMLInputElement).value)}
              />
              <small className="hint">{t("share.passphrase_hint")}</small>
            </label>
          </div>
        </details>
        <div className="share-footer">
          <button className="primary" type="submit">
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
