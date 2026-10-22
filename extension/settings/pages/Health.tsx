import { useEffect, useState } from "preact/hooks";
import { describeError, type Translate } from "../../../src/i18n/index.js";
import { breachCounts, reusedGroups, weakItems } from "../../lib/health.js";
import { requestItemFocus } from "../../lib/storage.js";
import { decryptAll } from "../../lib/vault/decrypt.js";
import type { VaultItem } from "../../lib/vault/types.js";
import { Button } from "../../ui/components/Button.js";
import { Card } from "../../ui/components/Card.js";
import { localeSignal, useT } from "../../ui/i18n.js";
import { vaultKeySignal } from "../../ui/store/session.js";

export function Health() {
  const t = useT();
  const locale = localeSignal.value;
  const vaultKey = vaultKeySignal.value;
  const [healthItems, setHealthItems] = useState<VaultItem[] | null>(null);
  const [breaches, setBreaches] = useState<Map<string, number> | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingBreaches, setCheckingBreaches] = useState(false);

  useEffect(() => {
    if (!vaultKey) {
      return;
    }
    let active = true;
    setHealthError(null);
    void decryptAll(vaultKey, locale)
      .then((items) => {
        if (active) {
          setHealthItems(items);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setHealthError(describeError(error, t));
        }
      });
    return () => {
      active = false;
    };
  }, [vaultKey, locale]);

  const checkBreaches = async () => {
    if (!healthItems) {
      return;
    }
    setCheckingBreaches(true);
    setHealthError(null);
    try {
      setBreaches(
        await breachCounts(healthItems.flatMap((item) => (item.password ? [item.password] : []))),
      );
    } catch (error) {
      setHealthError(describeError(error, t));
    } finally {
      setCheckingBreaches(false);
    }
  };

  const healthWeak = healthItems ? weakItems(healthItems) : [];
  const healthReused = healthItems ? reusedGroups(healthItems) : [];
  const healthExposed =
    breaches && healthItems
      ? healthItems.filter((item) => item.password && breaches.has(item.password))
      : [];

  return (
    <section className="page">
      <h1>{t("health.title")}</h1>
      <p className="lead">{t("health.lead")}</p>
      {!vaultKey ? (
        <p className="notice">{t("settings.locked_hint")}</p>
      ) : (
        <>
          <div className="stats">
            <div className={`stat ${healthWeak.length > 0 ? "bad" : ""}`}>
              <span className="stat-number">{healthItems ? healthWeak.length : "…"}</span>
              <span className="stat-label">{t("health.weak")}</span>
            </div>
            <div className={`stat ${healthReused.length > 0 ? "bad" : ""}`}>
              <span className="stat-number">{healthItems ? healthReused.flat().length : "…"}</span>
              <span className="stat-label">{t("health.reused")}</span>
            </div>
            <div className={`stat ${healthExposed.length > 0 ? "bad" : ""}`}>
              <span className="stat-number">
                {breaches ? healthExposed.length : t("health.not_checked")}
              </span>
              <span className="stat-label">{t("health.breached")}</span>
            </div>
          </div>
          <Card className="breach-check">
            <div className="row-text">
              <span>{t("health.check_breaches")}</span>
              <span className="row-hint">{t("health.breach_privacy")}</span>
            </div>
            <Button
              disabled={checkingBreaches || !healthItems}
              onClick={() => void checkBreaches()}
            >
              {checkingBreaches ? t("health.checking") : t("health.check")}
            </Button>
          </Card>
          {healthError && (
            <p className="error" role="alert">
              {healthError}
            </p>
          )}
          {healthItems &&
            breaches &&
            healthWeak.length + healthReused.length + healthExposed.length === 0 && (
              <p className="notice">{t("health.all_good")}</p>
            )}
          {healthItems && <HealthLists items={healthItems} breaches={breaches} t={t} />}
        </>
      )}
    </section>
  );
}

function HealthLists({
  items,
  breaches,
  t,
}: {
  items: VaultItem[];
  breaches: Map<string, number> | null;
  t: Translate;
}) {
  const weak = weakItems(items);
  const reused = reusedGroups(items);
  const exposed = breaches
    ? items.filter((item) => item.password && breaches.has(item.password))
    : [];
  const groups: { title: string; rows: VaultItem[]; detail: (item: VaultItem) => string }[] = [
    {
      title: t("health.breached"),
      rows: exposed,
      detail: (item) =>
        t("health.breached_hint", { count: breaches?.get(item.password ?? "") ?? 0 }),
    },
    { title: t("health.weak"), rows: weak, detail: () => t("health.weak_hint") },
    {
      title: t("health.reused"),
      rows: reused.flat(),
      detail: (item) => {
        const group = reused.find((candidate) => candidate.includes(item));
        return t("health.reused_hint", { count: (group?.length ?? 1) - 1 });
      },
    },
  ];
  return (
    <>
      {groups
        .filter(({ rows }) => rows.length > 0)
        .map(({ title, rows, detail }) => (
          <div key={title}>
            <h2>{title}</h2>
            <Card className="links">
              {rows.map((item) => (
                <div className="link-row" key={`${title}-${item.id}`}>
                  <div className="link-text">
                    <div className="link-title">{item.title}</div>
                    <div className="row-hint">
                      {[item.username, detail(item)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      void requestItemFocus(item.id).then(() =>
                        chrome.action.openPopup().catch(() => undefined),
                      );
                    }}
                  >
                    {t("health.fix")}
                  </Button>
                </div>
              ))}
            </Card>
          </div>
        ))}
    </>
  );
}
