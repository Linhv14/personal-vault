import type { Environment } from "#core/projects.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { useT } from "#ext/ui/i18n.js";
import { Badge } from "#ext/console/components.js";
import type { SecretsByEnvironment } from "./helpers.js";

export function Matrix({
  names,
  secrets,
  environments,
  tab,
}: {
  names: string[];
  secrets: SecretsByEnvironment;
  environments: Environment[];
  tab: (id: string | null) => string;
}) {
  const t = useT();
  const incomplete = names.filter((name) =>
    environments.some((env) => !secrets[env.id]?.some((secret) => secret.name === name)),
  ).length;
  return (
    <>
      <p className="matrix-summary">
        {incomplete === 0 ? (
          <Badge tone="ok">
            <Icon name="check" />
            {t("console.all_present")}
          </Badge>
        ) : (
          <Badge tone="warn">
            <Icon name="alert" />
            {t("console.incomplete", { count: incomplete })}
          </Badge>
        )}
      </p>
      <table className="table matrix">
        <thead>
          <tr>
            <th>{t("console.secret_name")}</th>
            {environments.map((env) => (
              <th key={env.id} className="center">
                <a href={tab(env.id)}>{env.name}</a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <td className="secret-name">
                <code>{name}</code>
              </td>
              {environments.map((env) => {
                const secret = secrets[env.id]?.find((entry) => entry.name === name);
                return (
                  <td key={env.id} className="center">
                    {secret ? (
                      secret.value === "" ? (
                        <Badge>{t("console.empty_value")}</Badge>
                      ) : (
                        <span className="cell-set" title={t("console.set")}>
                          <Icon name="check" />
                        </span>
                      )
                    ) : (
                      <a
                        href={tab(env.id)}
                        className="cell-missing"
                        title={t("console.missing")}
                        aria-label={t("console.missing")}
                      >
                        —
                      </a>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {names.length === 0 && <p className="table-empty">{t("console.no_match")}</p>}
    </>
  );
}
