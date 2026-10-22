import { generateTotp, parseTotpInput, type TotpConfig } from "#core/totp.js";
import type { TotpPrompt } from "../autofill-protocol.js";
import { getLocal } from "../storage.js";
import { isPersonal, openVault } from "../vault/decrypt.js";
import { byLastUsed } from "../vault/search.js";
import { matchesSite, sameSite } from "../vault/site-match.js";
import { markUsed, newItemId, saveItem } from "../vault/store.js";
import type { VaultItem } from "../vault/types.js";
import type { AutofillHandlers } from "./handler.js";
import { bySite, suggestionOf } from "./login.js";
import { fetchQrImage } from "./qr-image.js";
import { isVaultServer, type TrustedSender } from "./senders.js";
import { PENDING_TTL_MS, totpKey } from "./tab-state.js";

interface PendingTotp {
  domain: string;
  site?: string;
  config: TotpConfig;
  targetId?: string;
  at: number;
}

function totpTarget(items: VaultItem[], pageUrl: string): VaultItem | undefined {
  return items
    .filter((item) => isPersonal(item) && matchesSite(item, pageUrl) && sameSite(item, pageUrl))
    .sort(bySite(pageUrl))[0];
}

async function currentCode(config: TotpConfig): Promise<string> {
  const { clockSkew = 0 } = await getLocal();
  return generateTotp(config, Date.now() + clockSkew * 1000);
}

async function readPendingTotp(sender: TrustedSender): Promise<PendingTotp | null> {
  const key = totpKey(sender.tabId);
  const pending = (await chrome.storage.session.get(key))[key] as PendingTotp | undefined;
  if (!pending) {
    return null;
  }
  if (Date.now() - pending.at > PENDING_TTL_MS || pending.domain !== sender.domain) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return pending;
}

export const totpHandlers: AutofillHandlers<
  | "autofill:codes"
  | "autofill:code"
  | "autofill:totp-found"
  | "autofill:totp-save"
  | "autofill:totp-dismiss"
  | "autofill:qr-image"
> = {
  "autofill:codes": async (_request, sender) => {
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const suggestions = vault.items
      .filter((item) => item.totp && matchesSite(item, sender.url))
      .sort(byLastUsed)
      .map((item) => suggestionOf(item, vault));
    return { ok: true, locked: false, suggestions, domain: sender.domain };
  },

  "autofill:code": async (request, sender) => {
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const item = vault.items.find((candidate) => candidate.id === request.id);
    if (!item?.totp || !matchesSite(item, sender.url)) {
      return { ok: false, error: "no_match" };
    }
    void markUsed(vault.key, item).catch(() => {});
    return { ok: true, code: await currentCode(item.totp) };
  },

  "autofill:totp-found": async (request, sender) => {
    if (await isVaultServer(sender.url)) {
      return { ok: true, totp: null };
    }
    let config: TotpConfig;
    try {
      config = parseTotpInput(request.text);
    } catch {
      return { ok: true, totp: null };
    }
    const vault = await openVault();
    const target = vault ? totpTarget(vault.items, sender.url) : undefined;
    if (target?.totp?.secret === config.secret) {
      return { ok: true, totp: null };
    }
    const pending: PendingTotp = {
      domain: sender.domain,
      site: sender.site,
      config,
      ...(target ? { targetId: target.id } : {}),
      at: Date.now(),
    };
    await chrome.storage.session.set({ [totpKey(sender.tabId)]: pending });
    const prompt: TotpPrompt = {
      domain: sender.site ?? sender.domain,
      ...(target
        ? { target: target.username ? `${target.title} (${target.username})` : target.title }
        : {}),
      replace: Boolean(target?.totp),
    };
    return { ok: true, totp: prompt };
  },

  "autofill:totp-save": async (_request, sender) => {
    const pending = await readPendingTotp(sender);
    if (!pending) {
      return { ok: true, saved: false };
    }
    const vault = await openVault();
    if (!vault) {
      await chrome.action.openPopup?.().catch(() => {});
      return { ok: true, saved: false, locked: true };
    }
    const target = vault.items.find(
      (item) => item.id === pending.targetId && isPersonal(item) && matchesSite(item, sender.url),
    );
    await saveItem(
      vault.key,
      target
        ? { ...target, totp: pending.config }
        : {
            id: newItemId(),
            title: pending.site ?? pending.domain,
            url: pending.site ?? pending.domain,
            totp: pending.config,
          },
      target,
    );
    await chrome.storage.session.remove(totpKey(sender.tabId));
    return { ok: true, saved: true, code: await currentCode(pending.config) };
  },

  "autofill:totp-dismiss": async (_request, sender) => {
    await chrome.storage.session.remove(totpKey(sender.tabId));
    return { ok: true, saved: false };
  },

  "autofill:qr-image": async (request) => ({ ok: true, image: await fetchQrImage(request.url) }),
};
