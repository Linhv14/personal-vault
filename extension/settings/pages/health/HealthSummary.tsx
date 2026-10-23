import type { IconName } from "#ui/icons.js";
import { Button } from "#ext/ui/components/Button.js";
import { Card } from "#ext/ui/components/Card.js";
import { Icon } from "#ext/ui/components/Icon.js";
import { useT } from "#ext/ui/i18n.js";
import type { HealthReport } from "./useHealth.js";

export const SECTION_IDS = {
  exposed: "health-exposed",
  reused: "health-reused",
  weak: "health-weak",
  merges: "health-merges",
} as const;

type Tone = "danger" | "warn" | "ok";

function toneOf(report: HealthReport | null): Tone {
  if (!report) {
    return "ok";
  }
  if (report.exposed.length > 0) {
    return "danger";
  }
  return report.needsAttention > 0 || report.merges.length > 0 ? "warn" : "ok";
}

const TONE_ICON: Record<Tone, IconName> = { danger: "alert", warn: "shield", ok: "check" };

export function HealthSummary({
  report,
  breachesChecked,
  checking,
  onCheck,
}: {
  report: HealthReport | null;
  breachesChecked: boolean;
  checking: boolean;
  onCheck: () => void;
}) {
  const t = useT();
  const tone = toneOf(report);
  return (
    <Card className={`health-summary ${tone}`}>
      <span className="health-summary-icon">
        <Icon name={TONE_ICON[tone]} />
      </span>
      <div className="health-summary-text">
        <strong>
          {!report
            ? "…"
            : report.needsAttention > 0
              ? t("health.summary_issues", { count: report.needsAttention })
              : t("health.summary_clear")}
        </strong>
        <span className="row-hint">
          {[
            report && t("health.summary_checked", { count: report.checked }),
            breachesChecked ? t("health.summary_breaches_done") : t("health.summary_unchecked"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <Button
        variant={breachesChecked ? "default" : "primary"}
        disabled={checking || !report}
        onClick={onCheck}
      >
        {checking
          ? t("health.checking")
          : breachesChecked
            ? t("health.recheck")
            : t("health.check_breaches")}
      </Button>
      {!breachesChecked && <p className="health-privacy">{t("health.breach_privacy")}</p>}
    </Card>
  );
}

export function HealthTiles({
  report,
  breachesChecked,
}: {
  report: HealthReport | null;
  breachesChecked: boolean;
}) {
  const t = useT();
  const tiles: { id: string; icon: IconName; label: string; count: number | null; tone: Tone }[] = [
    {
      id: SECTION_IDS.exposed,
      icon: "alert",
      label: t("health.breached"),
      count: breachesChecked && report ? report.exposed.length : null,
      tone: "danger",
    },
    {
      id: SECTION_IDS.reused,
      icon: "copy",
      label: t("health.reused"),
      count: report ? report.reused.flat().length : null,
      tone: "warn",
    },
    {
      id: SECTION_IDS.weak,
      icon: "lock",
      label: t("health.weak"),
      count: report ? report.weak.length : null,
      tone: "warn",
    },
    {
      id: SECTION_IDS.merges,
      icon: "link",
      label: t("health.scattered"),
      count: report ? report.merges.length : null,
      tone: "warn",
    },
  ];
  return (
    <div className="health-tiles">
      {tiles.map((tile) => (
        <button
          type="button"
          key={tile.id}
          className={`health-tile ${tile.count ? tile.tone : ""}`}
          disabled={!tile.count}
          onClick={() => document.getElementById(tile.id)?.scrollIntoView({ behavior: "smooth" })}
        >
          <span className="health-tile-head">
            <Icon name={tile.icon} />
            {tile.label}
          </span>
          <span className={tile.count === null ? "health-tile-count pending" : "health-tile-count"}>
            {tile.count ??
              (report && tile.id === SECTION_IDS.exposed ? t("health.not_checked") : "…")}
          </span>
        </button>
      ))}
    </div>
  );
}
