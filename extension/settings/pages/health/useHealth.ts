import { useEffect, useMemo, useState } from "preact/hooks";
import { describeError } from "#i18n/index.js";
import { breachCounts, reusedGroups, weakItems, withPasswords } from "#ext/lib/health.js";
import { decryptAll } from "#ext/lib/vault/decrypt.js";
import { applySiteMerge, findSiteMerges, type SiteMerge } from "#ext/lib/vault/site-merge.js";
import type { VaultItem } from "#ext/lib/vault/types.js";
import { localeSignal, useT } from "#ext/ui/i18n.js";
import { vaultKeySignal } from "#ext/ui/store/session.js";

export interface HealthReport {
  checked: number;
  exposed: VaultItem[];
  reused: VaultItem[][];
  weak: VaultItem[];
  merges: SiteMerge[];
  needsAttention: number;
}

function reportOf(items: VaultItem[], breaches: Map<string, number> | null): HealthReport {
  const exposed = breaches
    ? items.filter((item) => item.password && breaches.has(item.password))
    : [];
  const reused = reusedGroups(items);
  const weak = weakItems(items);
  return {
    checked: withPasswords(items).length,
    exposed,
    reused,
    weak,
    merges: findSiteMerges(items),
    needsAttention: new Set([...exposed, ...reused.flat(), ...weak].map((item) => item.id)).size,
  };
}

export function useHealth() {
  const t = useT();
  const locale = localeSignal.value;
  const vaultKey = vaultKeySignal.value;
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [breaches, setBreaches] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!vaultKey) {
      return;
    }
    let active = true;
    void decryptAll(vaultKey, locale)
      .then((decrypted) => {
        if (active) {
          setItems(decrypted);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(describeError(caught, t));
        }
      });
    return () => {
      active = false;
    };
  }, [vaultKey, locale, revision]);

  const report = useMemo(() => (items ? reportOf(items, breaches) : null), [items, breaches]);

  const checkBreaches = async () => {
    if (!items) {
      return;
    }
    setChecking(true);
    setError(null);
    try {
      setBreaches(
        await breachCounts(items.flatMap((item) => (item.password ? [item.password] : []))),
      );
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setChecking(false);
    }
  };

  const merge = async (target: SiteMerge) => {
    if (!vaultKey) {
      return;
    }
    setMerging(target.domain);
    setError(null);
    try {
      await applySiteMerge(vaultKey, target);
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(describeError(caught, t));
    } finally {
      setMerging(null);
    }
  };

  return {
    locked: !vaultKey,
    report,
    breaches,
    error,
    checking,
    merging,
    checkBreaches,
    merge,
  };
}
