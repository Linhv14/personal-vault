import { useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import type { IconName } from "../../../src/ui/icons.js";
import {
  formatCardNumber,
  itemType,
  lastFour,
  KIND_LABEL,
  toggleUsedCode,
  TYPE_FIELDS,
  unusedCodes,
  type FieldSpec,
} from "../../lib/item-types.js";
import type { VaultItem } from "../../lib/vault.js";
import { daysUntilPurge } from "../../lib/trash.js";
import { vaultOf } from "../../lib/vaults.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";
import { MenuList } from "../components/Menu.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { Field, ValueRow } from "../components/FieldRow.js";
import { ItemIcon } from "../components/ItemIcons.js";
import { TotpRow } from "../components/Totp.js";
import {
  copy,
  CopySource,
  deleteForever,
  nowMs,
  formatDate,
  openEditor,
  openShare,
  setFavorite,
  setTrashed,
  setUsedCodes,
  vaults,
  toast,
} from "../state.js";

const KEY_ICON: Partial<Record<string, IconName>> = {
  username: "person",
  fullName: "person",
  cardholder: "person",
  email: "mail",
  phone: "id-card",
  address: "id-card",
  ssid: "wifi",
  bankName: "bank",
  accountNumber: "bank",
  iban: "bank",
  cardNumber: "card",
  sshPublicKey: "terminal",
  sshFingerprint: "terminal",
  licenseKey: "key",
};

function fieldIcon(spec: FieldSpec): IconName {
  const byKey = KEY_ICON[spec.key];
  if (byKey) return byKey;
  switch (spec.kind) {
    case "password":
    case "secret":
    case "multilineSecret":
      return "key";
    case "url":
      return "link";
    case "email":
      return "mail";
    case "expiry":
      return "clock";
    default:
      return "note";
  }
}

const SEPARATE_KEYS = new Set(["url", "note", "codes"]);

function MainRow({ spec, item }: { spec: FieldSpec; item: VaultItem }) {
  const t = useT();
  if (spec.key === "totp") return item.totp ? <TotpRow config={item.totp} /> : null;
  const value = item[spec.key as keyof VaultItem];
  if (typeof value !== "string" || !value) return null;
  const label = t(spec.label);
  const icon = fieldIcon(spec);
  switch (spec.kind) {
    case "password":
    case "secret":
      return <ValueRow icon={icon} label={label} value={value} secret />;
    case "multilineSecret":
      return <ValueRow icon={icon} label={label} value={value} secret masked={"•".repeat(12)} />;
    case "cardNumber":
      return (
        <ValueRow
          icon={icon}
          label={label}
          value={formatCardNumber(value)}
          secret
          masked={`•••• ${lastFour(value)}`}
        />
      );
    default:
      return (
        <ValueRow icon={icon} label={label} value={value} multiline={spec.kind === "multiline"} />
      );
  }
}

const LONG_CODE = 14;

const MASKED_CODE = "•".repeat(10);

function RecoveryCodes({ item }: { item: VaultItem }) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const codes = item.codes ?? [];
  const used = new Set(item.usedCodes ?? []);
  const unused = unusedCodes(item);
  const label = t("field.codes");

  return (
    <div className="group recovery">
      <div className="field-row static">
        <Icon name="life-buoy" className="field-icon" />
        <Field label={label}>
          <span className="v">
            {unused.length === codes.length
              ? t("item.codes_count", { count: codes.length })
              : t("item.codes_left", { left: unused.length, total: codes.length })}
          </span>
        </Field>
        <IconButton
          icon={revealed ? "eye-off" : "eye"}
          label={t(revealed ? "common.hide" : "common.show")}
          onClick={() => setRevealed(!revealed)}
        />
        {unused.length > 0 && (
          <IconButton
            icon="copy"
            label={t("item.copy_unused_codes")}
            onClick={() => void copy(unused.join("\n"), label.toLowerCase())}
          />
        )}
      </div>
      {unused.length === 0 && <p className="codes-note">{t("item.codes_all_used")}</p>}
      <ol
        className={codes.some((code) => code.length > LONG_CODE) ? "codes-grid long" : "codes-grid"}
      >
        {codes.map((code, index) => {
          const name = t("item.code", { number: index + 1 });
          const isUsed = used.has(code);
          return (
            <li className={isUsed ? "code used" : "code"} key={`${index}-${code}`}>
              <span className="code-index">{index + 1}</span>
              <button
                type="button"
                className="code-value mono"
                title={revealed ? `${code}\n${t("common.copy")}` : `${name} · ${t("common.copy")}`}
                onClick={() => void copy(code, name.toLowerCase())}
              >
                {revealed ? code : MASKED_CODE}
              </button>
              <IconButton
                icon="check"
                className="code-mark"
                label={t(isUsed ? "item.mark_unused" : "item.mark_used")}
                aria-pressed={isUsed}
                onClick={() => void setUsedCodes(item, toggleUsedCode(item, code))}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PasswordHistory({ item }: { item: VaultItem }) {
  const t = useT();
  const [opened, setOpened] = useState(false);
  const history = item.passwordHistory ?? [];
  if (history.length === 0) return null;
  return (
    <details className="group history" onToggle={() => setOpened(true)}>
      <summary>
        <Icon name="history" />
        {t("item.password_history", { count: history.length })}
      </summary>
      {opened &&
        history.map((change) => (
          <ValueRow
            key={change.changedAt}
            icon="key"
            label={t("item.changed_on", { date: formatDate(change.changedAt) })}
            value={change.password}
            secret
          />
        ))}
    </details>
  );
}

function Actions({ item }: { item: VaultItem }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      toast(describeError(error, t));
    }
  };

  if (item.trashedAt) {
    return (
      <div className="detail-actions">
        <IconButton
          icon="refresh"
          className="pill-icon"
          label={t("list.restore")}
          onClick={() => void run(() => setTrashed(item, false))}
        />
        <IconButton
          icon="trash"
          className="pill-icon danger"
          label={t("edit.delete")}
          onClick={() => void deleteForever(item)}
        />
      </div>
    );
  }

  const viewOnly = vaults.value.find((vault) => vault.id === vaultOf(item))?.shared?.viewOnly;
  if (viewOnly) {
    return (
      <div className="detail-actions">
        <button type="button" className="pill" disabled>
          <Icon name="eye" />
          {t("vault.view_only")}
        </button>
        {itemType(item) === "login" && (
          <IconButton
            icon="share"
            className="pill-icon"
            label={t("share.title")}
            onClick={() => void openShare(item)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="detail-actions">
      <button type="button" className="pill" onClick={() => openEditor(item)}>
        <Icon name="pencil" />
        {t("edit.edit_title")}
      </button>
      {itemType(item) === "login" && (
        <IconButton
          icon="share"
          className="pill-icon"
          label={t("share.title")}
          onClick={() => void openShare(item)}
        />
      )}
      <IconButton
        icon="star"
        className="pill-icon favorite-toggle"
        label={t(item.favorite ? "list.unfavorite" : "list.favorite")}
        aria-pressed={item.favorite === true}
        onClick={() => void setFavorite(item, !item.favorite)}
      />
      <div className="more">
        <IconButton
          icon="more"
          className="pill-icon"
          label={t("item.more")}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        />
        {more && (
          <MenuList
            align="right"
            onClose={() => setMore(false)}
            entries={[
              {
                key: "trash",
                label: t("edit.move_to_trash"),
                icon: "trash",
                danger: true,
                onSelect: () => void run(() => setTrashed(item, true)),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function Detail({ item }: { item: VaultItem | null }) {
  const t = useT();
  if (!item) {
    return (
      <section className="screen detail-empty" id="detail">
        <p>{t("detail.empty")}</p>
      </section>
    );
  }

  const type = itemType(item);
  const specs = TYPE_FIELDS[type];
  const main = specs.filter((spec) => !SEPARATE_KEYS.has(spec.key));
  const websites = [item.url, ...(item.urls ?? [])].filter((url): url is string => Boolean(url));
  const fields = item.fields ?? [];
  const purgeDays = daysUntilPurge(item, Math.floor(nowMs() / 1000));

  return (
    <CopySource.Provider value={item}>
      <section className="screen detail" id="detail" key={item.id}>
        <header className="detail-head">
          <ItemIcon item={item} />
          <div className="detail-title">
            <h1>{item.title}</h1>
            {purgeDays !== null ? (
              <p className={purgeDays <= 3 ? "purge-note soon" : "purge-note"}>
                <Icon name="clock" />
                {t("trash.purges_in", { days: purgeDays })}
              </p>
            ) : (
              <p>
                {[
                  t(KIND_LABEL[type]),
                  ...(vaults.value.length > 1
                    ? [vaults.value.find((vault) => vault.id === vaultOf(item))?.name ?? ""]
                    : []),
                  ...(item.tags ?? []),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <Actions item={item} />
        </header>

        <div className="detail-body">
          {main.some((spec) =>
            spec.key === "totp" ? item.totp : item[spec.key as keyof VaultItem],
          ) && (
            <div className="group">
              {main.map((spec) => (
                <MainRow spec={spec} item={item} key={spec.key} />
              ))}
            </div>
          )}

          {websites.length > 0 && (
            <div className="group">
              {websites.map((url, index) => (
                <ValueRow
                  key={`${index}-${url}`}
                  icon="link"
                  label={t("field.website")}
                  value={url}
                />
              ))}
            </div>
          )}

          {item.codes?.length ? <RecoveryCodes item={item} /> : null}

          {fields.length > 0 && (
            <div className="group">
              {fields.map((field, index) => (
                <ValueRow
                  key={`field-${index}`}
                  icon={field.hidden ? "key" : "note"}
                  label={field.label || t("edit.field_value")}
                  value={field.value}
                  secret={field.hidden === true}
                />
              ))}
            </div>
          )}

          {item.note && (
            <div className="group">
              <ValueRow icon="note" label={t("common.note")} value={item.note} multiline />
            </div>
          )}

          {item.passkey && (
            <div className="group">
              <div className="field-row static">
                <Icon name="shield" className="field-icon" />
                <Field label={t("common.passkey")}>
                  <span className="v">{t("item.passkey_saved", { site: item.passkey.rpId })}</span>
                </Field>
              </div>
            </div>
          )}

          <PasswordHistory item={item} />

          <dl className="detail-meta">
            {item.lastUsedAt && (
              <div>
                <dt>{t("item.last_used_label")}</dt>
                <dd>{formatDate(item.lastUsedAt)}</dd>
              </div>
            )}
            {(item.editedAt ?? item.updatedAt) && (
              <div>
                <dt>{t("console.last_change")}</dt>
                <dd>{formatDate(item.editedAt ?? item.updatedAt)}</dd>
              </div>
            )}
            {item.createdAt && (
              <div>
                <dt>{t("item.created_label")}</dt>
                <dd>{formatDate(item.createdAt)}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>
    </CopySource.Provider>
  );
}
