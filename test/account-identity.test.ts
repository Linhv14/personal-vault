import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultKey, importVaultKey } from "../src/core/crypto.js";
import { toBase64, utf8Encode } from "../src/core/bytes.js";
import { randomKey, unwrapForRecipient, wrapForRecipient } from "../src/core/identity.js";

const localArea = new Map<string, unknown>([["apiUrl", "https://vault.test"]]);
const sessionArea = new Map<string, unknown>([["token", "t"]]);
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
    remove: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  };
}
vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
});

const server = {
  identity: null as null | { publicKey: string; wrappedPrivateKey: unknown },
  puts: 0,
};
vi.stubGlobal(
  "fetch",
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      server.puts += 1;
      if (server.identity) {
        return new Response(JSON.stringify({ code: "account.identity_exists" }), { status: 409 });
      }
      server.identity = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ identity: server.identity }));
  }),
);

const { ensureIdentity } = await import("../extension/lib/identity.js");

let vaultKey: CryptoKey;
beforeEach(async () => {
  sessionArea.set("vaultKeyRaw", toBase64(createVaultKey()));
  vaultKey = await importVaultKey(createVaultKey());
  server.identity = null;
  server.puts = 0;
});

describe("account identity", () => {
  it("creates a key pair once and uploads only the sealed private key", async () => {
    const identity = await ensureIdentity(vaultKey);
    expect(server.puts).toBe(1);
    const uploaded = JSON.stringify(server.identity);
    expect(uploaded).not.toContain(toBase64(identity.privateKey));

    const again = await ensureIdentity(vaultKey);
    expect(server.puts).toBe(1);
    expect(again.publicKey).toBe(identity.publicKey);
    expect(again.privateKey).toEqual(identity.privateKey);
  });

  it("can open what others wrap for it", async () => {
    const identity = await ensureIdentity(vaultKey);
    const context = utf8Encode("personal-vault/team-key/t1");
    const teamKey = randomKey();
    const wrapped = await wrapForRecipient(identity.publicKey, teamKey, context);
    const reopened = await ensureIdentity(vaultKey);
    expect(await unwrapForRecipient(reopened, wrapped, context)).toEqual(teamKey);
  });

  it("cannot be opened with another vault key", async () => {
    await ensureIdentity(vaultKey);
    await expect(ensureIdentity(await importVaultKey(createVaultKey()))).rejects.toThrow();
  });

  it("adopts the key pair another device created first", async () => {
    const { createIdentity } = await import("../src/core/identity.js");
    const { seal } = await import("../src/core/crypto.js");
    const other = await createIdentity();
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    let first = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (first && init?.method !== "PUT") {
        first = false;
        server.identity = {
          publicKey: other.publicKey,
          wrappedPrivateKey: await seal(
            vaultKey,
            other.privateKey,
            utf8Encode("personal-vault/account-private-key"),
          ),
        };
        return new Response(JSON.stringify({ identity: null }));
      }
      return original(input, init);
    });
    const identity = await ensureIdentity(vaultKey);
    fetchMock.mockImplementation(original);
    expect(identity.publicKey).toBe(other.publicKey);
    expect(identity.privateKey).toEqual(other.privateKey);
  });
});
