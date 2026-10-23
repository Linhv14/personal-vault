import { Fragment } from "preact";
import { formText } from "#ui/form-data.js";
import { useEffect, useRef, useState } from "preact/hooks";
import { generatePassword } from "#core/generator.js";
import { describeError } from "#i18n/index.js";
import {
  HAS_PASSWORD_HISTORY,
  keepUsedCodes,
  NEW_LABEL,
  TYPE_FIELDS,
  withPasswordHistory,
  type FieldSpec,
  type ItemType,
} from "#ext/lib/item-types.js";
import { parseRecoveryCodes } from "#ext/lib/recovery-codes.js";
import { newItemId } from "#ext/lib/vault/store.js";
import type { VaultItem } from "#ext/lib/vault/types.js";
import { DEFAULT_VAULT_ID, vaultOf } from "#ext/lib/vault/defs.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { useT } from "#ext/ui/i18n.js";
import {
  CustomFieldsEditor,
  rowKey,
  WebsitesEditor,
  type CustomRow,
} from "../components/EditorRows.js";
import { initialValue, InvalidField, readEditedFields, type EditedFields } from "../edit-fields.js";
import { scanTotpFromTab, type ScanHint } from "../qr-scan.js";
import { newItemVault, nowMs, showList, tabUrl, toast, vaults } from "../state.js";
import { saveEditedItem, setTrashed } from "../item-actions.js";
import { formatEntropy } from "../strength.js";
import { OptionalField } from "../components/OptionalField.js";

function EditField({
  spec,
  item,
  type,
  onScanned,
}: {
  spec: FieldSpec;
  item: VaultItem | null;
  type: ItemType;
  onScanned: (issuer: string | undefined) => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [scanHint, setScanHint] = useState<ScanHint>(null);
  const input = useRef<HTMLInputElement>(null);
  const secret = spec.kind === "password" || spec.kind === "secret";
  const cvv = spec.key === "cardCvv";
  const multiline =
    spec.kind === "multiline" || spec.kind === "codes" || spec.kind === "multilineSecret";
  const value = initialValue(spec, item, tabUrl.value);

  const control = multiline ? (
    <textarea
      name={spec.key}
      rows={spec.kind === "multiline" ? (type === "note" ? 8 : 2) : spec.kind === "codes" ? 6 : 5}
      defaultValue={value}
      className={
        spec.kind === "codes"
          ? "mono"
          : spec.kind === "multilineSecret"
            ? revealed
              ? "mono"
              : "mono concealed"
            : undefined
      }
      onPaste={
        spec.kind === "codes"
          ? (event) => {
              const area = event.currentTarget;
              setTimeout(() => {
                const codes = parseRecoveryCodes(area.value);
                if (codes.length > 0) {
                  area.value = codes.join("\n");
                }
              });
            }
          : undefined
      }
    />
  ) : (
    <input
      ref={input}
      name={spec.key}
      autoComplete="off"
      defaultValue={value}
      type={
        secret && !revealed
          ? "password"
          : spec.kind === "email" || spec.kind === "tel"
            ? spec.kind
            : "text"
      }
      inputMode={
        spec.kind === "cardNumber" || spec.kind === "expiry" || cvv ? "numeric" : undefined
      }
      maxLength={spec.kind === "expiry" ? 5 : cvv ? 4 : undefined}
      pattern={spec.kind === "expiry" ? "(0[1-9]|1[0-2])/[0-9]{2}" : cvv ? "[0-9]{3,4}" : undefined}
      title={spec.kind === "expiry" ? "MM/YY" : undefined}
      onInput={
        spec.kind === "expiry"
          ? (event) => {
              const field = event.currentTarget;
              field.value = maskExpiry(field.value);
            }
          : cvv
            ? (event) => {
                const field = event.currentTarget;
                field.value = field.value.replace(/\D/g, "").slice(0, cvvLength(field.form));
              }
            : undefined
      }
      className={spec.kind === "cardNumber" ? "mono" : undefined}
      placeholder={
        spec.kind === "url"
          ? "example.com"
          : spec.kind === "totp"
            ? t("edit.totp_placeholder")
            : spec.kind === "expiry"
              ? "MM/YY"
              : cvv
                ? "123"
                : undefined
      }
    />
  );

  const actions = [
    (secret || spec.kind === "multilineSecret") && (
      <IconButton
        key="reveal"
        icon={revealed ? "eye-off" : "eye"}
        label={t(revealed ? "common.hide" : "common.show")}
        onClick={() => setRevealed(!revealed)}
      />
    ),
    spec.kind === "password" && (
      <IconButton
        key="generate"
        icon="refresh"
        label={t("edit.regenerate")}
        onClick={() => {
          const generated = generatePassword({ length: 20 });
          if (input.current) {
            input.current.value = generated.value;
          }
          setRevealed(true);
          toast(formatEntropy(generated, t));
        }}
      />
    ),
    spec.kind === "totp" && (
      <IconButton
        key="scan"
        icon="scan"
        label={t("edit.scan")}
        onClick={() =>
          void scanTotpFromTab(t, setScanHint).then((config) => {
            if (!config || !input.current) {
              return;
            }
            input.current.value = config.raw;
            onScanned(config.issuer);
          })
        }
      />
    ),
  ].filter(Boolean);

  return (
    <>
      <label>
        <span>{t(spec.label)}</span>
        {actions.length === 0 ? (
          control
        ) : (
          <span className="field-with-actions">
            {control}
            {actions}
          </span>
        )}
      </label>
      {scanHint && <p className={scanHint.failed ? "hint error-text" : "hint"}>{scanHint.text}</p>}
      {spec.kind === "codes" && <p className="hint">{t("field.codes_hint")}</p>}
      {spec.key === "url" && type === "login" && <WebsitesEditor item={item} />}
    </>
  );
}

function storedVault(id: string): string | undefined {
  return id === DEFAULT_VAULT_ID ? undefined : id;
}

function cvvLength(form: HTMLFormElement | null): number {
  const number = form?.elements.namedItem("cardNumber");
  const digits = number instanceof HTMLInputElement ? number.value.replace(/\D/g, "") : "";
  return /^3[47]/.test(digits) ? 4 : 3;
}

function maskExpiry(raw: string): string {
  let digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length === 1 && Number(digits) > 1) {
    digits = `0${digits}`;
  }
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function Editor({
  item,
  type,
  draft,
}: {
  item: VaultItem | null;
  type: ItemType;
  draft?: Partial<VaultItem>;
}) {
  const source = item ?? (draft ? ({ ...draft } as VaultItem) : null);
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [customRows, setCustomRows] = useState<CustomRow[]>(() =>
    (source?.fields ?? []).map((field) => ({
      key: rowKey(),
      label: field.label,
      value: field.value,
      hidden: field.hidden === true,
    })),
  );

  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('[name="title"]')?.focus();
  }, []);

  const initialVault = item ? vaultOf(item) : newItemVault();

  const titleField = () => form.current?.querySelector<HTMLInputElement>('[name="title"]');

  const submit = (event: Event) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget as HTMLFormElement);
    let fields: EditedFields;
    try {
      fields = readEditedFields(
        data,
        type,
        customRows.map((row) => row.hidden),
      );
    } catch (failure) {
      setError(
        failure instanceof InvalidField
          ? t(failure.messageKey)
          : t("edit.totp_parse_failed", { reason: describeError(failure, t) }),
      );
      return;
    }

    void saveEditedItem(
      {
        ...item,
        id: item?.id ?? newItemId(),
        type,
        title: formText(data, "title").trim(),
        vault: storedVault(formText(data, "vault") || initialVault),
        ...fields,
        usedCodes: keepUsedCodes(fields.codes, item?.usedCodes),
        passwordHistory: HAS_PASSWORD_HISTORY.has(type)
          ? withPasswordHistory(item, fields.password, Math.floor(nowMs() / 1000))
          : item?.passwordHistory,
      },
      item,
    );
  };

  const moveToTrash = () => {
    if (item) {
      void setTrashed(item, true);
    }
  };

  return (
    <section id="screen-edit" className="screen">
      <header className="title-bar">
        <IconButton icon="back" label={t("common.back")} onClick={showList} />
        <h1 id="edit-title">{t(item ? "edit.edit_title" : NEW_LABEL[type])}</h1>
      </header>
      <form id="form-edit" className="stack" ref={form} onSubmit={submit}>
        <label>
          <span>{t("edit.name")}</span>
          <input name="title" required autoComplete="off" defaultValue={source?.title ?? ""} />
        </label>
        {vaults.value.length > 1 && (
          <label>
            <span>{t("vault.field")}</span>
            <select name="vault">
              {vaults.value
                .filter((vault) => !vault.shared)
                .map((vault) => (
                  <option value={vault.id} key={vault.id} selected={vault.id === initialVault}>
                    {vault.name}
                  </option>
                ))}
              {[...new Set(vaults.value.flatMap((vault) => vault.shared?.orgName ?? []))].map(
                (org) => (
                  <optgroup label={org} key={org}>
                    {vaults.value
                      .filter((vault) => vault.shared?.orgName === org && !vault.shared.viewOnly)
                      .map((vault) => (
                        <option
                          value={vault.id}
                          key={vault.id}
                          selected={vault.id === initialVault}
                        >
                          {vault.name}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
        )}
        <div className="stack">
          {TYPE_FIELDS[type].map((spec) => (
            <Fragment key={spec.key}>
              {spec.key === "note" && (
                <CustomFieldsEditor rows={customRows} onChange={setCustomRows} />
              )}
              <OptionalField
                filled={!spec.optional || initialValue(spec, source, tabUrl.value) !== ""}
                label={t("edit.add_codes")}
              >
                <EditField
                  spec={spec}
                  item={source}
                  type={type}
                  onScanned={(issuer) => {
                    const title = titleField();
                    if (issuer && title && !title.value) {
                      title.value = issuer;
                    }
                  }}
                />
              </OptionalField>
            </Fragment>
          ))}
        </div>
        <label>
          <span>{t("edit.tags")}</span>
          <input
            name="tags"
            autoComplete="off"
            placeholder={t("edit.tags_hint")}
            defaultValue={item?.tags?.join(", ") ?? ""}
          />
        </label>
        <button className="primary" type="submit">
          {t("edit.save")}
        </button>
        <button
          type="button"
          className="link danger"
          id="edit-delete"
          hidden={!item}
          onClick={moveToTrash}
        >
          {t("edit.move_to_trash")}
        </button>
      </form>
      <p className="error" id="edit-error" hidden={!error}>
        {error}
      </p>
    </section>
  );
}
