import { useEffect, useRef, useState } from "preact/hooks";
import type { VaultItem } from "#ext/lib/vault/types.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { IconButton } from "#ext/ui/components/IconButton.js";
import { useT } from "#ext/ui/i18n.js";

let rowCount = 0;
export const rowKey = () => ++rowCount;

export function WebsitesEditor({ item }: { item: VaultItem | null }) {
  const t = useT();
  const [rows, setRows] = useState(() =>
    (item?.urls ?? []).map((value) => ({ key: rowKey(), value })),
  );
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey === null) {
      return;
    }
    list.current?.querySelector<HTMLInputElement>(`[data-row="${focusKey}"]`)?.focus();
  }, [focusKey]);

  return (
    <div className="stack tight">
      <div className="stack tight" ref={list}>
        {rows.map((row) => (
          <span className="field-with-actions" key={row.key}>
            <input
              name="urls"
              autoComplete="off"
              placeholder="example.com"
              defaultValue={row.value}
              data-row={row.key}
            />
            <IconButton
              icon="minus"
              label={t("edit.remove")}
              onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
            />
          </span>
        ))}
      </div>
      <button
        type="button"
        className="link add-row"
        onClick={() => {
          const key = rowKey();
          setRows([...rows, { key, value: "" }]);
          setFocusKey(key);
        }}
      >
        <Icon name="plus" />
        {t("edit.add_website")}
      </button>
      <label className="check inline">
        <input type="checkbox" name="urlMatch" defaultChecked={item?.urlMatch === "host"} />
        {t("edit.match_host")}
      </label>
    </div>
  );
}

export interface CustomRow {
  key: number;
  label: string;
  value: string;
  hidden: boolean;
}

export function CustomFieldsEditor({
  rows,
  onChange,
}: {
  rows: CustomRow[];
  onChange: (rows: CustomRow[]) => void;
}) {
  const t = useT();
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey === null) {
      return;
    }
    list.current?.querySelector<HTMLInputElement>(`[data-row="${focusKey}"]`)?.focus();
  }, [focusKey]);

  return (
    <div className="stack tight">
      <div className="stack" ref={list}>
        {rows.map((row) => (
          <div className="custom-row" key={row.key}>
            <input
              className="custom-label"
              name="customLabel"
              autoComplete="off"
              placeholder={t("edit.field_label")}
              defaultValue={row.label}
              data-row={row.key}
            />
            <span className="field-with-actions">
              <input
                className="custom-value"
                name="customValue"
                autoComplete="off"
                placeholder={t("edit.field_value")}
                type={row.hidden ? "password" : "text"}
                defaultValue={row.value}
              />
              <IconButton
                icon={row.hidden ? "eye-off" : "eye"}
                label={t("edit.hide_field")}
                aria-pressed={row.hidden}
                onClick={() =>
                  onChange(
                    rows.map((other) =>
                      other.key === row.key ? { ...other, hidden: !other.hidden } : other,
                    ),
                  )
                }
              />
              <IconButton
                icon="minus"
                label={t("edit.remove")}
                onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
              />
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="link add-row"
        onClick={() => {
          const key = rowKey();
          onChange([...rows, { key, label: "", value: "", hidden: false }]);
          setFocusKey(key);
        }}
      >
        <Icon name="plus" />
        {t("edit.add_field")}
      </button>
    </div>
  );
}
