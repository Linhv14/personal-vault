import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultKey, importVaultKey } from "../src/core/crypto.js";
import { toBase64 } from "../src/core/bytes.js";

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
    remove: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  };
}

vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  action: { openPopup: vi.fn(async () => {}) },
});
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/items" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ serverTime: Math.floor(Date.now() / 1000), items: [] }));
    }
    const id = url.pathname.split("/").pop()!;
    return new Response(JSON.stringify({ id, updatedAt: Math.floor(Date.now() / 1000) }));
  }),
);

const { handlePasskey } = await import("../extension/lib/passkey/service.js");
const { trustedSender } = await import("../extension/lib/autofill-service.js");
const { decryptAll } = await import("../extension/lib/vault/decrypt.js");

const page = trustedSender(
  { id: "ext", frameId: 0, url: "https://login.example.com/", tab: { id: 3 } as chrome.tabs.Tab },
  "ext",
)!;

const OPTIONS = {
  rpId: "example.com",
  rpName: "Example",
  challenge: "AAAAAAAAAAAAAAAAAAAAAA",
  userId: "dXNlcg",
  userName: "me@example.com",
  excludeCredentialIds: [] as string[],
};

let key: CryptoKey;

beforeEach(async () => {
  localArea.clear();
  sessionArea.clear();
  const raw = createVaultKey();
  key = await importVaultKey(raw);
  localArea.set("apiUrl", "https://vault.test");
  localArea.set("unboundItemsMigrated", true);
  sessionArea.set("vaultKeyRaw", toBase64(raw));
  sessionArea.set("token", "session-token");
});

describe("passkey service", () => {
  it("saves a new passkey and reports it as excluded on the next registration", async () => {
    const created = await handlePasskey({ type: "passkey:create", options: OPTIONS }, page);
    expect(created).toMatchObject({ ok: true });
    const credentialId = (created as { registration: { credentialId: string } }).registration
      .credentialId;

    const [item] = await decryptAll(key);
    expect(item).toMatchObject({
      title: "Example",
      url: "example.com",
      username: OPTIONS.userName,
    });
    expect(item?.passkey?.credentialId).toBe(credentialId);

    expect(
      await handlePasskey(
        {
          type: "passkey:query",
          rpId: "example.com",
          allowCredentialIds: [],
          excludeCredentialIds: [credentialId],
        },
        page,
      ),
    ).toMatchObject({ ok: true, state: "ready", excluded: true });
    expect(
      await handlePasskey(
        {
          type: "passkey:create",
          options: { ...OPTIONS, excludeCredentialIds: [credentialId] },
        },
        page,
      ),
    ).toEqual({ ok: false, error: "excluded" });
  });

  it("does not flag registrations whose excluded ids are not in the vault", async () => {
    expect(
      await handlePasskey(
        {
          type: "passkey:query",
          rpId: "example.com",
          allowCredentialIds: [],
          excludeCredentialIds: ["c29tZW9uZS1lbHNl"],
        },
        page,
      ),
    ).toMatchObject({ ok: true, state: "ready", passkeys: [], excluded: false });
  });

  it("lists a saved passkey for sign-in and signs with it", async () => {
    const created = await handlePasskey({ type: "passkey:create", options: OPTIONS }, page);
    const credentialId = (created as { registration: { credentialId: string } }).registration
      .credentialId;
    const query = await handlePasskey(
      { type: "passkey:query", rpId: "example.com", allowCredentialIds: [] },
      page,
    );
    expect(query).toMatchObject({
      state: "ready",
      passkeys: [{ credentialId, userName: OPTIONS.userName }],
    });
    expect(
      await handlePasskey(
        {
          type: "passkey:get",
          options: { rpId: "example.com", challenge: OPTIONS.challenge, allowCredentialIds: [] },
          credentialId,
        },
        page,
      ),
    ).toMatchObject({ ok: true, assertion: { credentialId } });
  });

  it("lists the passkey used last first", async () => {
    const ids: string[] = [];
    for (const userName of ["first@example.com", "second@example.com"]) {
      const created = await handlePasskey(
        { type: "passkey:create", options: { ...OPTIONS, userName } },
        page,
      );
      ids.push((created as { registration: { credentialId: string } }).registration.credentialId);
    }
    await handlePasskey(
      {
        type: "passkey:get",
        options: { rpId: "example.com", challenge: OPTIONS.challenge, allowCredentialIds: [] },
        credentialId: ids[1]!,
      },
      page,
    );
    for (let round = 0; round < 50; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const query = await handlePasskey(
      { type: "passkey:query", rpId: "example.com", allowCredentialIds: [] },
      page,
    );
    expect(query).toMatchObject({
      passkeys: [{ userName: "second@example.com" }, { userName: "first@example.com" }],
    });
  });
});
