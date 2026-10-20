import { Icon } from "../../ui/components/Icon.js";
import { useEffect } from "preact/hooks";
import { ITEM_TYPES, NEW_LABEL, TYPE_ICON, TYPE_LABEL } from "../../lib/item-types.js";
import { siteWarning } from "../../lib/site-warning.js";
import { registrableDomain } from "../../lib/vault.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { inScope, inVault, listView, live, scopeExists, typeCounts } from "../filters.js";
import { Dropdown } from "./Menu.js";
import { Row } from "./Row.js";
import {
  items,
  openEditor,
  openImport,
  scope,
  searchQuery,
  selectedId,
  sortOrder,
  tabUrl,
  typeFilter,
  currentVault,
} from "../state.js";

export function currentView() {
  const all = inVault(currentVault.value, items.value);
  const currentScope = scopeExists(scope.value, all) ? scope.value : "all";
  const view = listView({
    items: all,
    scope: currentScope,
    type: typeFilter.value,
    query: searchQuery.value,
    order: sortOrder.value,
    tabUrl: tabUrl.value,
    locale: localeSignal.value,
  });
  const visible = [...view.matched, ...view.rest];
  const selected = visible.find((item) => item.id === selectedId.value) ?? visible[0] ?? null;
  return { all, currentScope, view, visible, selected };
}

export function ListPane({ state }: { state: ReturnType<typeof currentView> }) {
  const t = useT();
  const { all, currentScope, view, visible, selected } = state;
  const counts = typeCounts(inScope(currentScope, all));
  const type = typeFilter.value;

  useEffect(() => {
    if (currentScope !== scope.value) scope.value = "all";
  }, [currentScope]);

  useEffect(() => {
    if (selected?.id !== selectedId.value) selectedId.value = selected?.id ?? null;
  }, [selected?.id]);

  const emptyVault = live(all).length === 0 && currentScope !== "trash";
  const warning = siteWarning(tabUrl.value, items.value);

  return (
    <aside className="list-pane">
      <div className="list-tools">
        <Dropdown
          id="type-filter"
          label={
            <span className="dropdown-label">
              <span className="dropdown-name">
                {type === "all" ? t("type.all") : t(TYPE_LABEL[type])}
              </span>
              <span className="count">
                ({type === "all" ? view.scoped.length : (counts.get(type) ?? 0)})
              </span>
            </span>
          }
          entries={[
            {
              key: "all",
              label: t("type.all"),
              icon: "database" as const,
              trailing: view.scoped.length,
              checked: type === "all",
              onSelect: () => (typeFilter.value = "all"),
            },
            ...ITEM_TYPES.map((entry) => ({
              key: entry,
              label: t(TYPE_LABEL[entry]),
              icon: TYPE_ICON[entry],
              trailing: counts.get(entry) ?? 0,
              checked: type === entry,
              onSelect: () => (typeFilter.value = entry),
            })),
          ]}
        />
        <Dropdown
          id="sort-order"
          align="right"
          title={`${t("list.sort")}: ${t(sortOrder.value === "recent" ? "list.sort_recent" : "list.sort_name")}`}
          label={<Icon name="sort" />}
          entries={[
            {
              key: "recent",
              label: t("list.sort_recent"),
              checked: sortOrder.value === "recent",
              onSelect: () => (sortOrder.value = "recent"),
            },
            {
              key: "name",
              label: t("list.sort_name"),
              checked: sortOrder.value === "name",
              onSelect: () => (sortOrder.value = "name"),
            },
          ]}
        />
      </div>
      <div className="list-scroll" role="listbox" aria-label={t("list.all_items")}>
        {warning && (
          <p className="lookalike-badge" role="alert">
            <Icon name="alert" />
            {t("autofill.lookalike_title", { domain: warning.target })}
          </p>
        )}
        {view.matched.length > 0 && (
          <>
            <h2 className="list-heading" id="matching-title">
              {t("list.matching_for", { domain: registrableDomain(tabUrl.value ?? "") ?? "" })}
            </h2>
            <div id="matching-list">
              {view.matched.map((item) => (
                <Row item={item} key={item.id} />
              ))}
            </div>
            {view.rest.length > 0 && <h2 className="list-heading">{t("list.all")}</h2>}
          </>
        )}
        <div id="all-list">
          {view.rest.map((item) => (
            <Row item={item} key={item.id} />
          ))}
        </div>
        {!emptyVault && visible.length === 0 && (
          <div className="list-empty" id="list-empty-type">
            <p>{searchQuery.value ? t("list.no_results") : t("list.empty_type")}</p>
            {type !== "all" && !searchQuery.value && currentScope !== "trash" && (
              <button type="button" className="secondary" onClick={() => openEditor(null, type)}>
                {t(NEW_LABEL[type])}
              </button>
            )}
          </div>
        )}
        {emptyVault && (
          <div className="list-empty">
            <p>{t("list.empty")}</p>
            <button type="button" className="secondary" onClick={openImport}>
              {t("list.import")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
