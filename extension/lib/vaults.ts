import type { VaultDef, VaultItem } from "./vault.js";

export const DEFAULT_VAULT_ID = "personal";
export const VAULT_COLORS = ["teal", "sky", "violet", "rose", "amber", "lime"] as const;
export const VAULT_ICONS = ["person", "home", "briefcase", "heart", "users", "star"] as const;
export type VaultColor = (typeof VAULT_COLORS)[number];
export type VaultIcon = (typeof VAULT_ICONS)[number];

export function vaultOf(item: Pick<VaultItem, "vault">): string {
  return item.vault ?? DEFAULT_VAULT_ID;
}

export function vaultList(records: VaultItem[], defaultName: string): VaultDef[] {
  const byId = new Map<string, VaultDef>();
  for (const record of [...records].sort((a, b) => a.updatedAt - b.updatedAt)) {
    for (const vault of record.vaults ?? []) {
      byId.set(vault.id, vault);
    }
  }
  const stored = byId.get(DEFAULT_VAULT_ID);
  byId.delete(DEFAULT_VAULT_ID);
  const fallback: VaultDef = {
    id: DEFAULT_VAULT_ID,
    name: defaultName,
    color: "teal",
    icon: "person",
  };
  return [{ ...fallback, ...stored, name: stored?.name || defaultName }, ...byId.values()];
}

export function withVault(vaults: VaultDef[], vault: VaultDef): VaultDef[] {
  return vaults.some((entry) => entry.id === vault.id)
    ? vaults.map((entry) => (entry.id === vault.id ? vault : entry))
    : [...vaults, vault];
}

export function withoutVault(vaults: VaultDef[], id: string): VaultDef[] {
  return id === DEFAULT_VAULT_ID ? vaults : vaults.filter((entry) => entry.id !== id);
}
