import { generatePassword } from "../../../src/core/generator.js";
import type { Suggestion } from "../autofill-protocol.js";
import { openVault, type OpenVault } from "../vault/decrypt.js";
import { byLastUsed } from "../vault/search.js";
import { matchesSite, sameSite } from "../vault/site-match.js";
import { markUsed } from "../vault/store.js";
import type { VaultItem } from "../vault/types.js";
import type { AutofillHandlers } from "./handler.js";
import { isVaultServer } from "./senders.js";

export function suggestionOf(item: VaultItem, vault: OpenVault): Suggestion {
  const shared = vault.sharedName(item);
  return {
    id: item.id,
    title: item.title,
    username: item.username,
    ...(shared ? { vault: shared } : {}),
  };
}

export function bySite(pageUrl: string) {
  const rank = (item: VaultItem) => (sameSite(item, pageUrl) === "exact" ? 0 : 1);
  return (a: VaultItem, b: VaultItem) => rank(a) - rank(b) || byLastUsed(a, b);
}

export const loginHandlers: AutofillHandlers<
  "autofill:suggest" | "autofill:fill" | "autofill:generate"
> = {
  "autofill:suggest": async (_request, sender) => {
    if (await isVaultServer(sender.url)) {
      return { ok: true, locked: false, suggestions: [], domain: sender.domain };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const suggestions = vault.items
      .filter((item) => matchesSite(item, sender.url))
      .sort(bySite(sender.url))
      .map((item) => suggestionOf(item, vault));
    return { ok: true, locked: false, suggestions, domain: sender.domain };
  },

  "autofill:fill": async (request, sender) => {
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const item = vault.items.find((candidate) => candidate.id === request.id);
    if (!item?.password || !matchesSite(item, sender.url)) {
      return { ok: false, error: "no_match" };
    }
    void markUsed(vault.key, item).catch(() => {});
    return { ok: true, credentials: { username: item.username, password: item.password } };
  },

  "autofill:generate": () =>
    Promise.resolve({ ok: true, password: generatePassword({ length: 20 }).value }),
};
