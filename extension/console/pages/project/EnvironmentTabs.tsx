import { MAX_ENVIRONMENTS, type Environment } from "../../../../src/core/projects.js";
import { Icon } from "../../../ui/components/Icon.js";
import { useT } from "../../../ui/i18n.js";
import { CI_TAB, type SecretsByEnvironment } from "./helpers.js";

export function EnvironmentTabs({
  environments,
  environment,
  ciTab,
  secrets,
  missing,
  guarded,
  canManage,
  tab,
  onAddEnvironment,
}: {
  environments: Environment[];
  environment: Environment | null;
  ciTab: boolean;
  secrets: SecretsByEnvironment | null;
  missing: { env: Environment; count: number }[];
  guarded: (envId: string) => boolean;
  canManage: boolean;
  tab: (id: string | null) => string;
  onAddEnvironment: () => void;
}) {
  const t = useT();
  return (
    <nav className="tabs" role="tablist">
      <a href={tab(null)} role="tab" aria-selected={!environment && !ciTab}>
        {t("console.overview")}
      </a>
      {environments.map((env) => {
        const gap = missing.find((entry) => entry.env.id === env.id)?.count ?? 0;
        return (
          <a href={tab(env.id)} role="tab" aria-selected={environment?.id === env.id} key={env.id}>
            {guarded(env.id) && (
              <span className="tab-lock" title={t("console.protected_tip")}>
                <Icon name="lock" />
              </span>
            )}
            {env.name}
            <span className="tab-count">{secrets?.[env.id]?.length ?? "–"}</span>
            {gap > 0 && (
              <span className="tab-dot" title={t("console.missing_count", { count: gap })} />
            )}
          </a>
        );
      })}
      <a href={tab(CI_TAB)} role="tab" aria-selected={ciTab} className="tab-ci">
        <Icon name="terminal" />
        {t("ci.tab")}
      </a>
      {canManage && environments.length < MAX_ENVIRONMENTS && (
        <button type="button" className="tab-add" onClick={onAddEnvironment}>
          <Icon name="plus" />
          {t("console.environment")}
        </button>
      )}
    </nav>
  );
}
