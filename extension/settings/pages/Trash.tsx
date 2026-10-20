import { useEffect, useRef, useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import type { IconName } from "../../../src/ui/icons.js";
import {
  ActionButton,
  Badge,
  Dialog,
  EmptyState,
  SearchInput,
  When,
} from "../../console/components.js";
import { attempt } from "../../console/data.js";
import { itemSubtitle } from "../../lib/item-subtitle.js";
import { itemType, TYPE_ICON } from "../../lib/item-types.js";
import { daysUntilPurge, deleteFromTrash, restoreFromTrash } from "../../lib/trash.js";
import { decryptEverything, type VaultDef, type VaultItem } from "../../lib/vault.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { vaultKeySignal } from "../../ui/store/session.js";
import { showToast } from "../state.js";

const PURGE_SOON_DAYS = 3;

export function Trash() {
  const t = useT();
  const locale = localeSignal.value;
  const vaultKey = vaultKeySignal.value;
  const [trashed, setTrashed] = useState<VaultItem[] | null>(null);
  const [vaults, setVaults] = useState<VaultDef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async (key: CryptoKey) => {
    const { items, shared } = await decryptEverything(key, locale, true, true);
    setVaults(shared);
    setTrashed(
      items
        .filter((item) => item.trashedAt)
        .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)),
    );
  };

  useEffect(() => {
    if (!vaultKey) return;
    setLoadError(null);
    load(vaultKey).catch((error: unknown) => setLoadError(describeError(error, t)));
  }, [vaultKey, locale]);

  const settle = async (ids: Set<string>, message: string) => {
    setTrashed((current) => current?.filter((item) => !ids.has(item.id)) ?? null);
    showToast(message);
    if (vaultKey) await load(vaultKey).catch(() => undefined);
  };

  const restore = async (list: VaultItem[]) => {
    if (!vaultKey) return;
    const done = new Set<string>();
    try {
      for (const item of list) {
        await restoreFromTrash(vaultKey, item);
        done.add(item.id);
      }
    } finally {
      if (done.size > 0) await settle(done, t("trash.restored", { count: done.size }));
    }
  };

  const remove = async (list: VaultItem[]) => {
    const done = new Set<string>();
    try {
      for (const item of list) {
        await deleteFromTrash(item);
        done.add(item.id);
      }
    } finally {
      if (done.size > 0) await settle(done, t("trash.deleted", { count: done.size }));
    }
  };

  return (
    <section className="page">
      <h1>{t("trash.title")}</h1>
      {!vaultKey ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : loadError ? (
        <p className="error" role="alert">
          {loadError}
        </p>
      ) : trashed ? (
        <TrashList
          items={trashed}
          vaults={vaults}
          now={Math.floor(Date.now() / 1000)}
          onRestore={restore}
          onDelete={remove}
        />
      ) : null}
    </section>
  );
}

export function TrashList({
  items,
  vaults,
  now,
  onRestore,
  onDelete,
}: {
  items: VaultItem[];
  vaults: VaultDef[];
  now: number;
  onRestore: (items: VaultItem[]) => Promise<void>;
  onDelete: (items: VaultItem[]) => Promise<void>;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ items: VaultItem[]; empty: boolean } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  const vaultOf = (item: VaultItem) => vaults.find((vault) => vault.id === item.vault);
  const editable = (item: VaultItem) => !vaultOf(item)?.shared?.viewOnly;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => item.title.toLowerCase().includes(needle))
    : items;
  const selectable = visible.filter(editable);
  const selected = selectable.filter((item) => picked.has(item.id));
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  useEffect(() => {
    if (selectAll.current) {
      selectAll.current.indeterminate = selected.length > 0 && !allSelected;
    }
  });

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const forget = (list: VaultItem[]) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const item of list) next.delete(item.id);
      return next;
    });

  const restore = async (list: VaultItem[]) => {
    if (
      await attempt(
        () => onRestore(list),
        (error) => describeError(error, t),
      )
    )
      forget(list);
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    const list = confirming.items;
    if (
      await attempt(
        () => onDelete(list),
        (error) => describeError(error, t),
      )
    ) {
      forget(list);
      setConfirming(null);
    }
  };

  if (items.length === 0) return <EmptyState icon="trash" title={t("trash.empty_state")} />;

  const deletable = items.filter(editable);
  return (
    <section className="panel trash">
      <div className="toolbar">
        <input
          ref={selectAll}
          type="checkbox"
          aria-label={t("trash.select_all")}
          title={t("trash.select_all")}
          checked={allSelected}
          disabled={selectable.length === 0}
          onChange={(event) =>
            setPicked(
              event.currentTarget.checked
                ? new Set([...picked, ...selectable.map((item) => item.id)])
                : new Set(),
            )
          }
        />
        <SearchInput value={query} onInput={setQuery} placeholder={t("trash.search")} />
        <div className="trash-actions">
          <ActionButton
            icon="history"
            disabled={selected.length === 0}
            onClick={() => restore(selected)}
          >
            {selected.length > 0
              ? t("trash.restore_count", { count: selected.length })
              : t("trash.restore")}
          </ActionButton>
          <button
            type="button"
            className="btn danger-text"
            disabled={selected.length === 0}
            onClick={() => setConfirming({ items: selected, empty: false })}
          >
            <Icon name="trash" />
            {selected.length > 0
              ? t("trash.delete_count", { count: selected.length })
              : t("trash.delete")}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={deletable.length === 0}
            onClick={() => setConfirming({ items: deletable, empty: true })}
          >
            {t("trash.empty")}
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="table-empty">
          <Icon name="search" />
          {t("trash.no_match")}
        </p>
      ) : (
        <table className="table">
          <tbody>
            {visible.map((item) => {
              const vault = vaultOf(item);
              const days = daysUntilPurge(item, now);
              const canEdit = editable(item);
              return (
                <tr key={item.id} data-id={item.id}>
                  <td className="trash-check">
                    <input
                      type="checkbox"
                      aria-label={t("trash.select", { title: item.title })}
                      checked={canEdit && picked.has(item.id)}
                      disabled={!canEdit}
                      onChange={(event) => toggle(item.id, event.currentTarget.checked)}
                    />
                  </td>
                  <td>
                    <span className="cell-title">
                      <span className="cell-icon">
                        <Icon name={TYPE_ICON[itemType(item)]} />
                      </span>
                      <span className="trash-text">
                        <span className="trash-name">{item.title}</span>
                        <span className="trash-sub">{itemSubtitle(item, t)}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <div className="chips">
                      {vault?.shared && (
                        <Badge tone="accent">
                          <Icon name={vault.icon as IconName} />
                          {vault.name}
                        </Badge>
                      )}
                      {item.trashedAt && (
                        <Badge>
                          <Icon name="trash" />
                          <When at={item.trashedAt} />
                        </Badge>
                      )}
                      {days !== null && (
                        <Badge tone={days <= PURGE_SOON_DAYS ? "danger" : "warn"}>
                          <Icon name="clock" />
                          {t("trash.purges_in", { days })}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="row-actions">
                    <IconButton
                      icon="history"
                      label={t("trash.restore")}
                      disabled={!canEdit}
                      onClick={() => void restore([item])}
                    />
                    <IconButton
                      icon="trash"
                      className="danger"
                      label={t("trash.delete")}
                      disabled={!canEdit}
                      onClick={() => setConfirming({ items: [item], empty: false })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {confirming && (
        <Dialog
          danger
          title={
            confirming.empty
              ? t("trash.confirm_empty")
              : t("trash.confirm_delete", { count: confirming.items.length })
          }
          description={t("trash.confirm_text", { count: confirming.items.length })}
          submitLabel={
            confirming.empty
              ? t("trash.empty")
              : confirming.items.length === 1
                ? t("trash.delete")
                : t("trash.delete_count", { count: confirming.items.length })
          }
          onClose={() => setConfirming(null)}
          onSubmit={() => void confirmDelete()}
        />
      )}
    </section>
  );
}
