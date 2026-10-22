import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultKey, importVaultKey, openJson, sealJson } from "../src/core/crypto.js";
import { utf8Encode } from "../src/core/bytes.js";

const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    },
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        store.set(key, value);
      }
    },
    remove: async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        store.delete(key);
      }
    },
    clear: async () => store.clear(),
  };
}

vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  alarms: { create: async () => {}, clear: async () => true },
});

const puts: { id: string; ciphertext: string; nonce: string }[] = [];
let rateLimited = 0;
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (rateLimited > 0) {
      rateLimited -= 1;
      return new Response(JSON.stringify({ code: "server.rate_limited" }), { status: 429 });
    }
    const id = new URL(String(input)).pathname.split("/").pop()!;
    puts.push({ id, ...JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id, updatedAt: 2_000 }), { status: 200 });
  }),
);

const { decryptAll, migrateUnboundItems, saveItem, saveItemPatiently } =
  await import("../extension/lib/vault.js");
const { clearAccountData } = await import("../extension/lib/storage.js");

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

describe("item binding to its id", () => {
  let key: CryptoKey;

  beforeEach(async () => {
    localArea.clear();
    sessionArea.clear();
    puts.length = 0;
    key = await importVaultKey(createVaultKey());
    localArea.set("apiUrl", "https://vault.test");
    sessionArea.set("vaultKeyRaw", "unused");
    sessionArea.set("token", "session-token");
  });

  it("seals new items so they only open under their own id", async () => {
    await saveItem(key, { id: ID_A, title: "Bank" });
    const [put] = puts;
    expect(await openJson(key, put!, utf8Encode(`personal-vault/item/${ID_A}`))).toMatchObject({
      title: "Bank",
    });
    await expect(openJson(key, put!)).rejects.toThrow();
  });

  it("rejects an item the server moved to another id", async () => {
    await saveItem(key, { id: ID_A, title: "Bank" });
    const stolen = puts[0]!;
    localArea.set("unboundItemsMigrated", true);
    localArea.set("items", [
      {
        id: ID_B,
        ciphertext: stolen.ciphertext,
        nonce: stolen.nonce,
        updatedAt: 1,
        deletedAt: null,
      },
    ]);
    expect(await decryptAll(key)).toEqual([]);
  });

  it("re-encrypts legacy items once, then stops accepting unbound ciphertext", async () => {
    const legacy = await sealJson(key, { id: ID_A, title: "Old", createdAt: 1, updatedAt: 1 });
    localArea.set("items", [{ id: ID_A, ...legacy, updatedAt: 1, deletedAt: null }]);

    expect((await decryptAll(key)).map((item) => item.title)).toEqual(["Old"]);
    expect(await migrateUnboundItems(key)).toBe(1);
    expect(puts.map((put) => put.id)).toEqual([ID_A]);
    expect(localArea.get("unboundItemsMigrated")).toBe(true);
    expect((await decryptAll(key)).map((item) => item.title)).toEqual(["Old"]);

    localArea.set("items", [{ id: ID_A, ...legacy, updatedAt: 3, deletedAt: null }]);
    expect(await decryptAll(key)).toEqual([]);
    expect(await migrateUnboundItems(key)).toBe(0);
  });

  it("refuses a legacy item whose sealed id is not the id it is stored under", async () => {
    const legacy = await sealJson(key, { id: ID_A, title: "Old", createdAt: 1, updatedAt: 1 });
    localArea.set("items", [{ id: ID_B, ...legacy, updatedAt: 1, deletedAt: null }]);
    expect(await decryptAll(key)).toEqual([]);
    expect(await migrateUnboundItems(key)).toBe(0);
    expect(puts).toEqual([]);
  });

  it("remembers a migrated account after sign-out so the fallback stays off", async () => {
    localArea.set("email", "me@example.com");
    const legacy = await sealJson(key, { id: ID_A, title: "Old", createdAt: 1, updatedAt: 1 });
    localArea.set("items", [{ id: ID_A, ...legacy, updatedAt: 1, deletedAt: null }]);
    expect(await migrateUnboundItems(key)).toBe(1);

    await clearAccountData();
    expect(localArea.get("unboundItemsMigrated")).toBeUndefined();
    localArea.set("apiUrl", "https://vault.test");
    localArea.set("email", "Me@Example.com");
    localArea.set("items", [{ id: ID_A, ...legacy, updatedAt: 3, deletedAt: null }]);
    expect(await decryptAll(key)).toEqual([]);
    expect(await migrateUnboundItems(key)).toBe(0);
    expect(localArea.get("unboundItemsMigrated")).toBe(true);

    localArea.set("email", "someone-else@example.com");
    localArea.delete("unboundItemsMigrated");
    expect((await decryptAll(key)).map((item) => item.title)).toEqual(["Old"]);
  });

  it("runs one migration at a time", async () => {
    const legacy = await sealJson(key, { id: ID_A, title: "Old", createdAt: 1, updatedAt: 1 });
    localArea.set("items", [{ id: ID_A, ...legacy, updatedAt: 1, deletedAt: null }]);
    const [first, second] = await Promise.all([migrateUnboundItems(key), migrateUnboundItems(key)]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(puts.map((put) => put.id)).toEqual([ID_A]);
  });

  it("keeps trashed items out of normal reads but exposes them for recovery", async () => {
    await saveItem(key, { id: ID_A, title: "Old login", tags: ["work"], trashedAt: 10 });
    expect(await decryptAll(key)).toEqual([]);
    expect((await decryptAll(key, "en", true)).map((item) => item.title)).toEqual(["Old login"]);
  });
});

describe("clearAccountData", () => {
  it("drops the account but keeps this device's preferences", async () => {
    const { clearAccountData } = await import("../extension/lib/storage.js");
    localArea.clear();
    for (const [key, value] of Object.entries({
      email: "me@example.com",
      items: [{ id: "x" }],
      wrappedVaultKey: { ciphertext: "c", nonce: "n" },
      locale: "vi",
      autoLockMinutes: 30,
      autofillPromoDismissed: true,
    })) {
      localArea.set(key, value);
    }
    await clearAccountData();
    expect(Object.fromEntries(localArea)).toEqual({
      locale: "vi",
      autoLockMinutes: 30,
      autofillPromoDismissed: true,
    });
  });
});

describe("auto-lock", () => {
  beforeEach(() => {
    localArea.clear();
    sessionArea.clear();
    vi.useRealTimers();
  });

  it("locks once the chosen idle time has passed", async () => {
    const { getUnlocked, unlock } = await import("../extension/lib/storage.js");
    localArea.set("autoLockMinutes", 15);
    await unlock("key", "token");
    expect(await getUnlocked()).not.toBeNull();
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    expect(await getUnlocked()).toBeNull();
  });

  it("stays unlocked until the browser closes when that is chosen", async () => {
    const { LOCK_ON_BROWSER_CLOSE, getUnlocked, touch, unlock } =
      await import("../extension/lib/storage.js");
    localArea.set("autoLockMinutes", 15);
    await unlock("key", "token");
    localArea.set("autoLockMinutes", LOCK_ON_BROWSER_CLOSE);
    await touch();
    expect(sessionArea.has("lockAt")).toBe(false);
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60_000 });
    expect(await getUnlocked()).not.toBeNull();
  });
});

describe("saving under the write limit", () => {
  it("waits out the server's rate limit and then saves", async () => {
    localArea.set("apiUrl", "https://vault.test");
    sessionArea.set("vaultKeyRaw", "x");
    sessionArea.set("token", "t");
    const key = await importVaultKey(createVaultKey());
    rateLimited = 2;
    let waits = 0;
    const saved = await saveItemPatiently(
      key,
      { id: ID_B, title: "Patient" },
      () => (waits += 1),
      async () => {},
    );
    expect(waits).toBe(2);
    expect(saved.title).toBe("Patient");
  });

  it("stays unlocked by default, with no idle deadline", async () => {
    localArea.clear();
    sessionArea.clear();
    const { getUnlocked, unlock } = await import("../extension/lib/storage.js");
    await unlock("key", "token");
    expect(sessionArea.has("lockAt")).toBe(false);
    expect(await getUnlocked()).not.toBeNull();
  });
});
