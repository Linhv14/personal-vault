import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64, utf8Encode } from "../src/core/bytes.js";
import { importVaultKey, seal, sealJson } from "../src/core/crypto.js";
import { createIdentity, randomKey, wrapForRecipient } from "../src/core/identity.js";
import { teamKeyContext } from "../src/core/org-model.js";
import { sealTeamItem } from "../src/core/team-items.js";
import { memoryArea, usePlatform, type StorageArea } from "../extension/lib/platform.js";
import { handleAutofill } from "../extension/lib/autofill/service.js";
import { handlePasskey } from "../extension/lib/passkey/service.js";
import { syncSharedVaults } from "../extension/lib/vault/shared.js";
import { sharedVaultId } from "../extension/lib/vault/vault-ids.js";
import { decryptEverything } from "../extension/lib/vault/decrypt.js";
import { removeItem } from "../extension/lib/vault/store.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const PLANTED = "33333333-3333-4333-8333-333333333333";
const MINE = "44444444-4444-4444-8444-444444444444";
const SENDER = { tabId: 1, url: "https://bank.com/login", domain: "bank.com" };

let calls: { url: string; method?: string; body?: string }[] = [];
let local: StorageArea;
let vaultKey: CryptoKey;

async function setup(plantedId = PLANTED) {
  const raw = randomKey();
  vaultKey = await importVaultKey(raw);
  const me = await createIdentity();
  const teamKey = randomKey();
  const personal = await sealJson(
    vaultKey,
    {
      id: MINE,
      title: "My bank",
      url: "https://bank.com",
      username: "victim@corp.com",
      password: "old",
      createdAt: 1,
      updatedAt: 1,
    },
    utf8Encode(`personal-vault/item/${MINE}`),
  );
  const planted = await sealTeamItem(
    teamKey,
    { teamId: TEAM, generation: 0, itemId: plantedId },
    {
      id: plantedId,
      title: "!",
      url: "bank.com",
      username: "victim@corp.com",
      password: "attacker",
      createdAt: 1,
      updatedAt: 1,
    },
  );
  local = memoryArea({
    apiUrl: "http://server.test",
    unboundItemsMigrated: true,
    items: [{ id: MINE, ...personal, updatedAt: 5, deletedAt: null }],
    identity: {
      publicKey: me.publicKey,
      wrappedPrivateKey: await seal(
        vaultKey,
        me.privateKey,
        utf8Encode("personal-vault/account-private-key"),
      ),
    },
    sharedVaults: [
      {
        orgId: ORG,
        orgName: "Acme",
        teamId: TEAM,
        name: "Eng",
        generation: 0,
        rekeyNeeded: false,
        wrappedKey: await wrapForRecipient(me.publicKey, teamKey, teamKeyContext(TEAM, 0)),
        items: [{ id: plantedId, sealed: planted, updatedAt: 9, updatedBy: "attacker" }],
      },
    ],
  });
  usePlatform({
    local,
    session: memoryArea({ vaultKeyRaw: toBase64(raw), token: "t" }),
    scheduleLock: async () => {},
  });
}

beforeEach(() => {
  calls = [];
  const store: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (patch: Record<string, unknown>) => Object.assign(store, patch),
        remove: async (key: string) => void delete store[key],
      },
    },
    action: {},
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method, body: init.body as string | undefined });
      return new Response(JSON.stringify({ updatedAt: 10, deletedAt: 10, ok: true }));
    }),
  );
});

describe("items other team members wrote", () => {
  it("never receive a password captured on a site", async () => {
    await setup();
    await handleAutofill(
      { type: "autofill:capture", username: "victim@corp.com", password: "NEW" },
      SENDER,
    );
    await handleAutofill({ type: "autofill:confirm" }, SENDER);
    await handleAutofill({ type: "autofill:save" }, SENDER);
    expect(calls.some((call) => call.url.includes("/teams/"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith(`/api/items/${MINE}`))).toBe(true);
  });

  it("never receive a new passkey", async () => {
    await setup();
    await local.set({ items: [] });
    await handlePasskey(
      {
        type: "passkey:create",
        options: {
          rpId: "bank.com",
          rpName: "Bank",
          challenge: "AAAA",
          userId: "dXNlcg",
          userName: "victim@corp.com",
          userDisplayName: "Victim",
          excludeCredentialIds: [],
        },
      },
      SENDER,
    );
    expect(calls.some((call) => call.url.includes("/teams/"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/api/items/"))).toBe(true);
  });

  it("are labelled with their vault when suggested", async () => {
    await setup();
    const reply = await handleAutofill({ type: "autofill:suggest" }, SENDER);
    expect(reply).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ id: PLANTED, vault: "Eng · Acme" }),
        expect.objectContaining({ id: MINE }),
      ]),
    });
    const mine = (reply as { suggestions: { id: string; vault?: string }[] }).suggestions.find(
      (entry) => entry.id === MINE,
    );
    expect(mine?.vault).toBeUndefined();
  });

  it("cannot shadow or delete a personal item by reusing its id", async () => {
    await setup(MINE);
    const { items } = await decryptEverything(vaultKey, "en", false, true);
    const matches = items.filter((item) => item.id === MINE);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ title: "My bank" });
    expect(matches[0]!.vault).toBeUndefined();
    await removeItem(MINE);
    expect(calls.map((call) => call.url)).toEqual([`http://server.test/api/items/${MINE}`]);
    calls = [];
    await removeItem(MINE, { vault: sharedVaultId(ORG, TEAM) });
    expect(calls[0]?.url).toContain(`/teams/${TEAM}/items/${MINE}`);
  });
});

describe("team vault sync", () => {
  it("refuses a team key older than one already seen", async () => {
    await setup();
    const [current] = (await local.get("sharedVaults")).sharedVaults as { generation: number }[];
    await local.set({ sharedGenerations: { [TEAM]: 3 } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ vaults: [{ ...current, generation: 1 }] }))),
    );
    await syncSharedVaults();
    const { sharedVaults, sharedGenerations } = await local.get([
      "sharedVaults",
      "sharedGenerations",
    ]);
    expect((sharedVaults as { generation: number }[]).map((vault) => vault.generation)).toEqual([
      0,
    ]);
    expect(sharedGenerations).toEqual({ [TEAM]: 3 });
  });
});
