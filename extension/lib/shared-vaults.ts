import type { SealedData } from "../../src/core/crypto.js";
import type { Bytes } from "../../src/core/bytes.js";
import { unwrapForRecipient, type Identity } from "../../src/core/identity.js";
import { teamKeyContext } from "../../src/core/org-model.js";
import { openTeamItem, sealTeamItem } from "../../src/core/team-items.js";
import { ApiError, request } from "./api.js";
import { knownIdentity } from "./identity.js";
import { getLocal, setLocal, type CachedSharedVault } from "./storage.js";
import type { VaultDef, VaultItem } from "./vault.js";

const PREFIX = "team:";

export function sharedVaultId(orgId: string, teamId: string): string {
  return `${PREFIX}${orgId}:${teamId}`;
}

export function isSharedVaultId(id: string | undefined): id is string {
  return typeof id === "string" && id.startsWith(PREFIX);
}

function idOf(vault: Pick<CachedSharedVault, "orgId" | "teamId">): string {
  return sharedVaultId(vault.orgId, vault.teamId);
}

export function sharedVaultDefs(vaults: CachedSharedVault[]): VaultDef[] {
  return vaults.map((vault) => ({
    id: idOf(vault),
    name: vault.name,
    color: "sky",
    icon: "users",
    shared: { orgName: vault.orgName, rekeyNeeded: vault.rekeyNeeded },
  }));
}

async function cachedVaults(): Promise<CachedSharedVault[]> {
  return (await getLocal()).sharedVaults ?? [];
}

function fingerprint(vaults: CachedSharedVault[]): string {
  return JSON.stringify(
    vaults.map((vault) => [
      idOf(vault),
      vault.name,
      vault.generation,
      vault.rekeyNeeded,
      vault.items.map((item) => [item.id, item.updatedAt, item.sealed.nonce]),
    ]),
  );
}

export async function syncSharedVaults(): Promise<number | null> {
  let vaults: CachedSharedVault[];
  try {
    ({ vaults } = await request<{ vaults: CachedSharedVault[] }>("/api/vaults"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) return null;
    throw error;
  }
  const before = await cachedVaults();
  if (fingerprint(before) === fingerprint(vaults)) return 0;
  await setLocal({ sharedVaults: vaults });
  return 1;
}

const teamKeys = new Map<string, Bytes>();

async function keyOf(vault: CachedSharedVault, me: Identity): Promise<Bytes> {
  const memo = `${vault.teamId}/${vault.generation}/${vault.wrappedKey.ephemeralPublicKey}`;
  const known = teamKeys.get(memo);
  if (known) return known;
  const key = new Uint8Array(
    await unwrapForRecipient(me, vault.wrappedKey, teamKeyContext(vault.teamId, vault.generation)),
  );
  teamKeys.set(memo, key);
  return key;
}

export async function decryptSharedVaults(
  vaultKey: CryptoKey,
  includeTrashed: boolean,
): Promise<{ items: VaultItem[]; vaults: VaultDef[] }> {
  const vaults = await cachedVaults();
  if (vaults.length === 0) return { items: [], vaults: [] };
  const me = await knownIdentity(vaultKey).catch(() => null);
  if (!me) return { items: [], vaults: [] };
  const items: VaultItem[] = [];
  const readable: CachedSharedVault[] = [];
  for (const vault of vaults) {
    let key: Bytes;
    try {
      key = await keyOf(vault, me);
    } catch {
      console.warn("Skipping shared vault whose key failed to open:", vault.teamId);
      continue;
    }
    readable.push(vault);
    for (const record of vault.items) {
      try {
        const item = await openTeamItem<VaultItem>(
          key,
          { teamId: vault.teamId, generation: vault.generation, itemId: record.id },
          record.sealed,
        );
        if (item.trashedAt && !includeTrashed) continue;
        items.push({ ...item, id: record.id, vault: idOf(vault), updatedAt: record.updatedAt });
      } catch {
        console.warn("Skipping shared item that failed to decrypt:", record.id);
      }
    }
  }
  return { items, vaults: sharedVaultDefs(readable) };
}

export async function sharedVaultOf(itemId: string): Promise<string | null> {
  const vault = (await cachedVaults()).find((entry) =>
    entry.items.some((item) => item.id === itemId),
  );
  return vault ? idOf(vault) : null;
}

async function findVault(id: string): Promise<CachedSharedVault> {
  const vault = (await cachedVaults()).find((entry) => idOf(entry) === id);
  if (!vault) throw new ApiError("error.orgs.not_found", 404);
  return vault;
}

function itemPath(vault: CachedSharedVault, itemId: string): string {
  return `/api/orgs/${vault.orgId}/teams/${vault.teamId}/items/${itemId}`;
}

async function updateCache(
  id: string,
  change: (items: CachedSharedVault["items"]) => CachedSharedVault["items"],
): Promise<void> {
  const vaults = await cachedVaults();
  await setLocal({
    sharedVaults: vaults.map((vault) =>
      idOf(vault) === id ? { ...vault, items: change(vault.items) } : vault,
    ),
  });
}

async function put(
  vaultKey: CryptoKey,
  vault: CachedSharedVault,
  item: VaultItem,
): Promise<{ sealed: SealedData; updatedAt: number }> {
  const me = await knownIdentity(vaultKey);
  if (!me) throw new ApiError("error.orgs.not_in_team", 403);
  const { vault: _vault, ...content } = item;
  const sealed = await sealTeamItem(
    await keyOf(vault, me),
    { teamId: vault.teamId, generation: vault.generation, itemId: item.id },
    content,
  );
  const { updatedAt } = await request<{ updatedAt: number }>(itemPath(vault, item.id), {
    method: "PUT",
    body: JSON.stringify({ sealed, generation: vault.generation }),
  });
  return { sealed, updatedAt };
}

export async function saveSharedItem(
  vaultKey: CryptoKey,
  vaultId: string,
  item: VaultItem,
): Promise<VaultItem> {
  let vault = await findVault(vaultId);
  let written: { sealed: SealedData; updatedAt: number };
  try {
    written = await put(vaultKey, vault, item);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    if ((await syncSharedVaults()) === null) throw error;
    vault = await findVault(vaultId);
    written = await put(vaultKey, vault, item);
  }
  const { sealed, updatedAt } = written;
  await updateCache(vaultId, (items) => [
    ...items.filter((entry) => entry.id !== item.id),
    { id: item.id, sealed, updatedAt, updatedBy: "" },
  ]);
  return { ...item, vault: vaultId, updatedAt };
}

export async function removeSharedItem(vaultId: string, itemId: string): Promise<void> {
  const vault = await findVault(vaultId);
  await request(itemPath(vault, itemId), { method: "DELETE" });
  await updateCache(vaultId, (items) => items.filter((entry) => entry.id !== itemId));
}

export function consolePathOf(vaultId: string): string {
  const [orgId = "", teamId = ""] = vaultId.slice(PREFIX.length).split(":");
  return `#/${orgId}/teams/${teamId}`;
}
