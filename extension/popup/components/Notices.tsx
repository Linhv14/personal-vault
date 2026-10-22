import { useEffect, useState } from "preact/hooks";
import type { PendingPrompt } from "../../lib/autofill-protocol.js";
import { forgetMissedSave, handleAutofill, missedSave } from "../../lib/autofill-service.js";
import { tabSender, type TrustedSender } from "../../lib/autofill/senders.js";
import type { IconName } from "../../../src/ui/icons.js";
import { biometricLabel } from "../../lib/biometric.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { Logo } from "../../ui/components/Logo.js";
import { useT } from "../../ui/i18n.js";
import { acceptPromo, activePromo, dismissPromo, orgSnapshot, refreshPromos } from "../promos.js";
import {
  openConsole,
  clockWarning,
  reloadItems,
  syncing,
  syncProblem,
  toast,
  vaultKey,
} from "../state.js";

function PromoBanner() {
  const t = useT();
  const promo = activePromo.value;
  if (!promo) {
    return null;
  }

  const invites = orgSnapshot.value?.invites ?? [];
  const content: Record<typeof promo, { icon: IconName | null; text: string; action: string }> = {
    biometric: {
      icon: "fingerprint",
      text: t("bio.promo", { method: t(biometricLabel()) }),
      action: t("bio.promo_action"),
    },
    invites: {
      icon: "users",
      text:
        invites.length === 1
          ? t("orgs.invited_to", { name: invites[0]!.orgName })
          : t("orgs.invited_many", { count: invites.length }),
      action: t("orgs.review"),
    },
    autofill: { icon: null, text: t("list.autofill_promo"), action: t("list.autofill_enable") },
  };
  const { icon, text, action } = content[promo];

  return (
    <div className="promo">
      {icon ? (
        <span className="promo-icon">
          <Icon name={icon} />
        </span>
      ) : (
        <Logo size={22} />
      )}
      <span className="promo-text">{text}</span>
      <button
        className="link"
        onClick={() => (promo === "invites" ? openConsole() : void acceptPromo(promo))}
      >
        {action}
      </button>
      <IconButton icon="close" label={t("common.close")} onClick={() => void dismissPromo(promo)} />
    </div>
  );
}

function MissedSave() {
  const t = useT();
  const [missed, setMissed] = useState<{ sender: TrustedSender; prompt: PendingPrompt } | null>(
    null,
  );
  useEffect(() => {
    if (!vaultKey.value) {
      return;
    }
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const sender = tabSender(tab);
      const prompt = sender ? await missedSave(sender) : null;
      setMissed(sender && prompt ? { sender, prompt } : null);
    });
  }, [vaultKey.value]);

  if (!missed) {
    return null;
  }
  const { sender, prompt } = missed;
  const save = async () => {
    setMissed(null);
    const response = await handleAutofill({ type: "autofill:save" }, sender);
    if (response.ok && "saved" in response && response.saved) {
      await reloadItems();
      toast(t("autofill.saved"));
    } else {
      toast(t("autofill.save_failed"));
    }
  };

  return (
    <div className="promo">
      <span className="promo-icon">
        <Icon name="key" />
      </span>
      <span className="promo-text">
        {t(prompt.update ? "autofill.update_title" : "autofill.save_title", {
          domain: prompt.domain,
        })}
      </span>
      <button className="link" onClick={() => void save()}>
        {t(prompt.update ? "autofill.update" : "autofill.save")}
      </button>
      <IconButton
        icon="close"
        label={t("common.close")}
        onClick={() => {
          setMissed(null);
          void forgetMissedSave(sender);
        }}
      />
    </div>
  );
}

export function Notices() {
  const problem = syncProblem.value;
  useEffect(() => {
    if (vaultKey.value) {
      void refreshPromos();
    }
  }, [vaultKey.value]);

  return (
    <>
      <div className="sync-bar" hidden={!syncing.value} />
      {problem && (
        <p className={problem.kind === "failed" ? "notice-line failed" : "notice-line"}>
          <Icon name={problem.kind === "failed" ? "alert" : "cloud-off"} />
          {problem.message}
        </p>
      )}
      {clockWarning.value && <p className="notice-line warn">{clockWarning.value}</p>}
      <MissedSave />
      <PromoBanner />
    </>
  );
}
