import { warn } from "../log.js";
import { decryptSharedVaults, isSharedVaultId } from "./shared.js";
import { getLocal, getUnlocked } from "../storage.js";
import { importKey, isLive, openItem } from "./item-crypto.js";
import { unboundItemsAllowed } from "./migrate.js";
import type { VaultDef, VaultItem } from "./types.js";

export interface OpenVault {
  key: CryptoKey;
  items: VaultItem[];
  sharedName: (item: Pick<VaultItem, "vault">) => string | undefined;
}

export function isPersonal(item: Pick<VaultItem, "vault">): boolean {
  return !isSharedVaultId(item.vault);
}

export async function openVault(): Promise<OpenVault | null> {
  const session = await getUnlocked();
  if (!session) {
    return null;
  }
  const key = await importKey(session.vaultKeyRaw);
  const { items, shared } = await decryptEverything(key, "en", false, true);
  const names = new Map(
    shared.map((vault) => [vault.id, `${vault.name} · ${vault.shared?.orgName ?? ""}`]),
  );
  return { key, items, sharedName: (item) => (item.vault ? names.get(item.vault) : undefined) };
}

export async function decryptEverything(
  key: CryptoKey,
  locale = "en",
  includeTrashed = false,
  includeShared = false,
): Promise<{ items: VaultItem[]; system: VaultItem[]; shared: VaultDef[] }> {
  const { items = [] } = await getLocal();
  const allowUnbound = await unboundItemsAllowed();
  const output: VaultItem[] = [];
  const system: VaultItem[] = [];

  for (const row of items) {
    if (!isLive(row)) {
      continue;
    }
    try {
      const { item } = await openItem(key, row, allowUnbound);
      const resolved = { ...item, id: row.id, updatedAt: row.updatedAt };
      if (resolved.system) {
        system.push(resolved);
      } else if (!resolved.trashedAt || includeTrashed) {
        output.push(resolved);
      }
    } catch {
      warn("Skipping item that failed to decrypt:", row.id);
    }
  }

  const shared = includeShared
    ? await decryptSharedVaults(
        key,
        includeTrashed,
        new Set([...output, ...system].map((item) => item.id)),
      )
    : { items: [], vaults: [] };
  output.push(...shared.items);
  return {
    items: output.sort((a, b) => a.title.localeCompare(b.title, locale)),
    system,
    shared: shared.vaults,
  };
}

export async function decryptAll(
  key: CryptoKey,
  locale = "en",
  includeTrashed = false,
): Promise<VaultItem[]> {
  return (await decryptEverything(key, locale, includeTrashed)).items;
}
