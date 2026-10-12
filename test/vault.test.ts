import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultKey, importVaultKey, openJson, sealJson } from "../src/core/crypto.js";
import { utf8Encode } from "../src/core/bytes.js";

const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      if (keys === null) return Object.fromEntries(store);
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    },
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
    },
    clear: async () => store.clear(),
  };
}

vi.stubGlobal("chrome", { storage: { local: area(localArea), session: area(sessionArea) } });

const puts: { id: string; ciphertext: string; nonce: string }[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = new URL(String(input)).pathname.split("/").pop()!;
    puts.push({ id, ...JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id, updatedAt: 2_000 }), { status: 200 });
  }),
);

const { decryptAll, migrateUnboundItems, saveItem } = await import("../extension/lib/vault.js");

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
});

describe("registrableDomain", () => {
  it("groups subdomains of an ordinary site", async () => {
    const { registrableDomain } = await import("../extension/lib/vault.js");
    expect(registrableDomain("https://accounts.google.com/signin")).toBe("google.com");
    expect(registrableDomain("www.github.com")).toBe("github.com");
    expect(registrableDomain("https://shop.example.com.vn")).toBe("example.com.vn");
  });

  it("keeps tenants of shared hosting apart", async () => {
    const { registrableDomain } = await import("../extension/lib/vault.js");
    expect(registrableDomain("https://alice.github.io")).toBe("alice.github.io");
    expect(registrableDomain("https://alice.github.io")).not.toBe(
      registrableDomain("https://mallory.github.io"),
    );
    expect(registrableDomain("https://personal-vault.linhdv.workers.dev")).toBe(
      "linhdv.workers.dev",
    );
  });

  it("never collapses IP addresses", async () => {
    const { registrableDomain } = await import("../extension/lib/vault.js");
    expect(registrableDomain("http://192.168.1.1")).toBe("192.168.1.1");
    expect(registrableDomain("http://10.0.1.1")).toBe("10.0.1.1");
    expect(registrableDomain("http://[::1]:8080")).toBe("[::1]");
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
