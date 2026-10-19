import { beforeEach, describe, expect, it } from "vitest";
import { utf8Encode } from "../src/core/bytes.js";
import { importVaultKey, seal } from "../src/core/crypto.js";
import { createIdentity, randomKey, wrapForRecipient } from "../src/core/identity.js";
import { teamKeyContext } from "../src/core/org-model.js";
import { sealTeamItem } from "../src/core/team-items.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import {
  consolePathOf,
  decryptSharedVaults,
  isSharedVaultId,
  sharedVaultId,
} from "../extension/lib/shared-vaults.js";
import type { CachedSharedVault } from "../extension/lib/storage.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

async function setup(options: { generation?: number; sealGeneration?: number } = {}) {
  const generation = options.generation ?? 2;
  const vaultKey = await importVaultKey(randomKey());
  const me = await createIdentity();
  const teamKey = randomKey();
  const vault: CachedSharedVault = {
    orgId: ORG,
    orgName: "Family",
    teamId: TEAM,
    name: "Home",
    generation,
    rekeyNeeded: false,
    wrappedKey: await wrapForRecipient(me.publicKey, teamKey, teamKeyContext(TEAM, generation)),
    items: [
      {
        id: ITEM,
        sealed: await sealTeamItem(
          teamKey,
          { teamId: TEAM, generation: options.sealGeneration ?? generation, itemId: ITEM },
          { id: ITEM, title: "Wi-Fi", password: "home-pass", createdAt: 1, updatedAt: 1 },
        ),
        updatedAt: 50,
        updatedBy: "someone",
      },
    ],
  };
  usePlatform({
    local: memoryArea({
      identity: {
        publicKey: me.publicKey,
        wrappedPrivateKey: await seal(
          vaultKey,
          me.privateKey,
          utf8Encode("personal-vault/account-private-key"),
        ),
      },
      sharedVaults: [vault],
    }),
    session: memoryArea(),
    scheduleLock: async () => {},
  });
  return vaultKey;
}

describe("shared vaults", () => {
  beforeEach(() =>
    usePlatform({ local: memoryArea(), session: memoryArea(), scheduleLock: async () => {} }),
  );

  it("names a team vault by organization and team", () => {
    const id = sharedVaultId(ORG, TEAM);
    expect(isSharedVaultId(id)).toBe(true);
    expect(isSharedVaultId("personal")).toBe(false);
    expect(isSharedVaultId(undefined)).toBe(false);
    expect(consolePathOf(id)).toBe(`#/${ORG}/teams/${TEAM}`);
  });

  it("opens cached team items offline with the account's own key", async () => {
    const vaultKey = await setup();
    const { items, vaults } = await decryptSharedVaults(vaultKey, false);
    expect(vaults).toEqual([
      expect.objectContaining({
        id: sharedVaultId(ORG, TEAM),
        name: "Home",
        shared: { orgName: "Family", rekeyNeeded: false },
      }),
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        id: ITEM,
        title: "Wi-Fi",
        password: "home-pass",
        vault: sharedVaultId(ORG, TEAM),
        updatedAt: 50,
      }),
    ]);
  });

  it("skips an item sealed for another key generation", async () => {
    const vaultKey = await setup({ generation: 3, sealGeneration: 2 });
    const { items, vaults } = await decryptSharedVaults(vaultKey, false);
    expect(vaults).toHaveLength(1);
    expect(items).toEqual([]);
  });

  it("shows nothing to an account whose key cannot open the team key", async () => {
    await setup();
    const stranger = await importVaultKey(randomKey());
    expect(await decryptSharedVaults(stranger, false)).toEqual({ items: [], vaults: [] });
  });
});
