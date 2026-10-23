import type { ComponentChildren } from "preact";
import { useT } from "#ext/ui/i18n.js";
import { IssueRow, MergeRow, ReusedGroup, StrengthBar } from "./HealthRows.js";
import { HealthSummary, HealthTiles, SECTION_IDS } from "./HealthSummary.js";
import { useHealth } from "./useHealth.js";

function HealthSection({
  id,
  tone,
  title,
  count,
  lead,
  children,
}: {
  id: string;
  tone: "danger" | "warn";
  title: string;
  count: number;
  lead: string;
  children: ComponentChildren;
}) {
  return (
    <section className={`health-section ${tone}`} id={id}>
      <header className="health-section-head">
        <h2>{title}</h2>
        <span className="health-count">{count}</span>
      </header>
      <p className="health-section-lead">{lead}</p>
      <div className="health-list">{children}</div>
    </section>
  );
}

export function Health() {
  const t = useT();
  const { locked, report, breaches, error, checking, merging, checkBreaches, merge } = useHealth();

  return (
    <section className="page health">
      <h1>{t("health.title")}</h1>
      <p className="lead">{t("health.lead")}</p>
      {locked ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : (
        <>
          <HealthSummary
            report={report}
            breachesChecked={breaches !== null}
            checking={checking}
            onCheck={() => void checkBreaches()}
          />
          <HealthTiles report={report} breachesChecked={breaches !== null} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {report && report.exposed.length > 0 && (
            <HealthSection
              id={SECTION_IDS.exposed}
              tone="danger"
              title={t("health.breached")}
              count={report.exposed.length}
              lead={t("health.breached_lead")}
            >
              {report.exposed.map((item) => (
                <IssueRow
                  item={item}
                  key={item.id}
                  detail={
                    <span className="health-pill danger">
                      {t("health.breached_hint", {
                        count: breaches?.get(item.password ?? "") ?? 0,
                      })}
                    </span>
                  }
                />
              ))}
            </HealthSection>
          )}
          {report && report.reused.length > 0 && (
            <HealthSection
              id={SECTION_IDS.reused}
              tone="warn"
              title={t("health.reused")}
              count={report.reused.flat().length}
              lead={t("health.reused_lead")}
            >
              {report.reused.map((group) => (
                <ReusedGroup items={group} key={group[0]?.id} />
              ))}
            </HealthSection>
          )}
          {report && report.weak.length > 0 && (
            <HealthSection
              id={SECTION_IDS.weak}
              tone="warn"
              title={t("health.weak")}
              count={report.weak.length}
              lead={t("health.weak_lead")}
            >
              {report.weak.map((item) => (
                <IssueRow
                  item={item}
                  key={item.id}
                  detail={<StrengthBar password={item.password ?? ""} />}
                />
              ))}
            </HealthSection>
          )}
          {report && report.merges.length > 0 && (
            <HealthSection
              id={SECTION_IDS.merges}
              tone="warn"
              title={t("health.scattered")}
              count={report.merges.length}
              lead={t("health.merge_lead")}
            >
              {report.merges.map((entry) => (
                <MergeRow
                  merge={entry}
                  key={entry.domain}
                  busy={merging === entry.domain}
                  disabled={merging !== null}
                  onMerge={() => void merge(entry)}
                />
              ))}
            </HealthSection>
          )}
        </>
      )}
    </section>
  );
}
