import { countryOf } from "../../../src/core/address-data.js";
import { generateAddress } from "../../../src/core/address-generator.js";
import { aliasTag, emailAliases } from "../../../src/core/email-alias.js";
import { registrableDomain } from "../../../src/core/site.js";
import type { AddressData, IdentitySuggestion } from "../autofill-protocol.js";
import { boundToSite } from "../captured-forms.js";
import { itemType } from "../item-types.js";
import { getLocal } from "../storage.js";
import { openVault, type OpenVault } from "../vault/decrypt.js";
import { byLastUsed } from "../vault/search.js";
import { markUsed } from "../vault/store.js";
import type { VaultItem } from "../vault/types.js";
import type { AutofillHandlers } from "./handler.js";
import { formsAllowed } from "./senders.js";

function isIdentity(item: VaultItem): boolean {
  return itemType(item) === "identity";
}

function identitySuggestionOf(item: VaultItem, vault: OpenVault): IdentitySuggestion {
  const shared = vault.sharedName(item);
  const detail = [item.fullName, item.city].filter(Boolean).join(" · ");
  const country = countryOf(item.country)?.code;
  return {
    id: item.id,
    title: item.title,
    ...(detail ? { detail } : {}),
    ...(country ? { country } : {}),
    ...(shared ? { vault: shared } : {}),
  };
}

function addressDataOf(item: Partial<VaultItem>): AddressData {
  const keys = [
    "fullName",
    "email",
    "phone",
    "company",
    "address",
    "ward",
    "city",
    "region",
    "postalCode",
    "country",
  ] as const;
  return Object.fromEntries(keys.flatMap((key) => (item[key] ? [[key, item[key]]] : [])));
}

function bySiteBound(domain: string) {
  const rank = (item: VaultItem) => (boundToSite(item, domain) ? 0 : 1);
  return (a: VaultItem, b: VaultItem) => rank(a) - rank(b) || byLastUsed(a, b);
}

export const identityHandlers: AutofillHandlers<
  "autofill:identities" | "autofill:identity" | "autofill:random-address" | "autofill:aliases"
> = {
  "autofill:identities": async (_request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: true, locked: false, identities: [] };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const identities = vault.items
      .filter(isIdentity)
      .sort(bySiteBound(sender.domain))
      .map((item) => identitySuggestionOf(item, vault));
    return { ok: true, locked: false, identities };
  },

  "autofill:identity": async (request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: false, error: "no_match" };
    }
    const vault = await openVault();
    if (!vault) {
      return { ok: true, locked: true };
    }
    const item = vault.items.find((candidate) => candidate.id === request.id);
    if (!item || !isIdentity(item)) {
      return { ok: false, error: "no_match" };
    }
    void markUsed(vault.key, item).catch(() => {});
    return { ok: true, identity: addressDataOf(item) };
  },

  "autofill:random-address": async (request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: false, error: "no_match" };
    }
    const country = request.country === "VN" ? "VN" : "US";
    return { ok: true, identity: addressDataOf(generateAddress({ country, email: true })) };
  },

  "autofill:aliases": async (_request, sender) => {
    if (!(await formsAllowed(sender))) {
      return { ok: true, aliases: [], site: "" };
    }
    const site = registrableDomain(sender.url) ?? sender.domain;
    const tag = aliasTag(site);
    const { email } = await getLocal();
    const vault = await openVault();
    const known = vault
      ? vault.items.filter(isIdentity).flatMap((item) => (item.email ? [item.email] : []))
      : [];
    return {
      ok: true,
      aliases: emailAliases([...(email ? [email] : []), ...known], tag),
      site: tag,
    };
  },
};
