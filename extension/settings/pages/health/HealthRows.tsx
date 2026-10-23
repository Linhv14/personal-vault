import type { ComponentChildren } from "preact";
import { passwordEntropy } from "#ext/lib/health.js";
import { requestItemFocus } from "#ext/lib/storage.js";
import type { SiteMerge } from "#ext/lib/vault/site-merge.js";
import type { VaultItem } from "#ext/lib/vault/types.js";
import { Button } from "#ext/ui/components/Button.js";
import { ItemIcon } from "#ext/ui/components/ItemIcons.js";
import { useT } from "#ext/ui/i18n.js";

const FULL_STRENGTH_BITS = 100;
const VERY_WEAK_BITS = 35;

function openItem(id: string) {
  void requestItemFocus(id).then(() => chrome.action.openPopup().catch(() => undefined));
}

export function IssueRow({ item, detail }: { item: VaultItem; detail?: ComponentChildren }) {
  const t = useT();
  return (
    <div className="health-row">
      <ItemIcon item={item} />
      <div className="health-row-text">
        <div className="link-title">{item.title}</div>
        {item.username && <div className="row-hint">{item.username}</div>}
      </div>
      {detail}
      <Button onClick={() => openItem(item.id)}>{t("health.fix")}</Button>
    </div>
  );
}

export function StrengthBar({ password }: { password: string }) {
  const t = useT();
  const bits = passwordEntropy(password);
  const percent = Math.max(6, Math.min(100, (bits / FULL_STRENGTH_BITS) * 100));
  return (
    <span className="strength" title={`${t("health.strength")}: ${Math.round(bits)} bits`}>
      <span
        className={bits < VERY_WEAK_BITS ? "strength-fill danger" : "strength-fill warn"}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

export function ReusedGroup({ items }: { items: VaultItem[] }) {
  const t = useT();
  return (
    <div className="health-group">
      <div className="health-group-head">{t("health.reused_group", { count: items.length })}</div>
      {items.map((item) => (
        <IssueRow item={item} key={item.id} />
      ))}
    </div>
  );
}

export function MergeRow({
  merge,
  busy,
  disabled,
  onMerge,
}: {
  merge: SiteMerge;
  busy: boolean;
  disabled: boolean;
  onMerge: () => void;
}) {
  const t = useT();
  const parts = [
    merge.passkeyFrom && t("health.merge_passkey", { title: merge.passkeyFrom.title }),
    merge.codesFrom && t("health.merge_codes", { title: merge.codesFrom.title }),
  ].filter(Boolean);
  return (
    <div className="health-row">
      <ItemIcon item={merge.target} />
      <div className="health-row-text">
        <div className="link-title">{merge.target.title}</div>
        <div className="row-hint">{parts.join(" · ")}</div>
      </div>
      <Button variant="primary" disabled={disabled} onClick={onMerge}>
        {busy ? t("health.merging") : t("health.merge")}
      </Button>
    </div>
  );
}
