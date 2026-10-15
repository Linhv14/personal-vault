import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultKey, importVaultKey } from "../src/core/crypto.js";
import { toBase64 } from "../src/core/bytes.js";

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
    remove: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  };
}

const openPopup = vi.fn(async () => {});
vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  action: { openPopup },
});

const puts: string[] = [];
const conditions: (string | null)[] = [];
const remote = { changes: [] as unknown[], conflict: false };
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/items" && (init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({ serverTime: Math.floor(Date.now() / 1000), items: remote.changes }),
      );
    }
    const id = url.pathname.split("/").pop()!;
    conditions.push(url.searchParams.get("ifUpdatedAt"));
    if (remote.conflict && url.searchParams.has("ifUpdatedAt")) {
      return new Response(JSON.stringify({ code: "items.conflict" }), { status: 409 });
    }
    puts.push(id);
    return new Response(JSON.stringify({ id, updatedAt: Math.floor(Date.now() / 1000) + 1 }));
  }),
);

async function settled(done: () => boolean = () => false): Promise<void> {
  const deadline = Date.now() + 500;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

const { handleAutofill, trustedSender } = await import("../extension/lib/autofill-service.js");
const { saveItem, decryptAll } = await import("../extension/lib/vault.js");

const EXTENSION_ID = "vault-extension";

function sender(url: string, overrides: Partial<chrome.runtime.MessageSender> = {}) {
  return trustedSender(
    { id: EXTENSION_ID, frameId: 0, url, tab: { id: 7 } as chrome.tabs.Tab, ...overrides },
    EXTENSION_ID,
  );
}

let key: CryptoKey;

async function unlockWith(items: Parameters<typeof saveItem>[1][]) {
  const raw = createVaultKey();
  key = await importVaultKey(raw);
  localArea.set("apiUrl", "https://vault.test");
  localArea.set("unboundItemsMigrated", true);
  sessionArea.set("vaultKeyRaw", toBase64(raw));
  sessionArea.set("token", "session-token");
  for (const item of items) await saveItem(key, item);
  puts.length = 0;
}

async function unlockFresh(items: Parameters<typeof saveItem>[1][]) {
  await unlockWith(items);
  conditions.length = 0;
}

const GITHUB = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "GitHub",
  url: "github.com",
  username: "me@example.com",
  password: "github-password",
};
const EVIL = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Elsewhere",
  url: "elsewhere.com",
  username: "me",
  password: "elsewhere-password",
};
const PAGES = {
  id: "00000000-0000-4000-8000-000000000003",
  title: "Alice pages",
  url: "alice.github.io",
  username: "alice",
  password: "pages-password",
};

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  localArea.clear();
  sessionArea.clear();
  puts.length = 0;
  conditions.length = 0;
  remote.changes = [];
  remote.conflict = false;
});

describe("trustedSender", () => {
  it("accepts the top frame of an https page from this extension", () => {
    expect(sender("https://github.com/login")).toEqual({
      tabId: 7,
      url: "https://github.com/login",
      domain: "github.com",
    });
  });

  it("rejects other extensions, sub-frames, plain http and tab-less senders", () => {
    expect(sender("https://github.com/login", { id: "someone-else" })).toBeNull();
    expect(sender("https://github.com/login", { frameId: 3 })).toBeNull();
    expect(sender("http://github.com/login")).toBeNull();
    expect(sender("https://github.com/login", { tab: undefined })).toBeNull();
  });

  it("allows http only on localhost", () => {
    expect(sender("http://localhost:3000/login")?.domain).toBe("localhost");
  });
});

describe("suggest and fill", () => {
  it("reports a locked vault without revealing anything", async () => {
    const response = await handleAutofill(
      { type: "autofill:suggest" },
      sender("https://github.com")!,
    );
    expect(response).toEqual({ ok: true, locked: true });
  });

  it("suggests only logins for the page's own domain, without passwords", async () => {
    await unlockWith([GITHUB, EVIL, PAGES]);
    const response = await handleAutofill(
      { type: "autofill:suggest" },
      sender("https://gist.github.com/")!,
    );
    expect(response).toEqual({
      ok: true,
      locked: false,
      domain: "github.com",
      suggestions: [{ id: GITHUB.id, title: "GitHub", username: GITHUB.username }],
    });
  });

  it("suggests a login on any of its websites", async () => {
    const login = { ...GITHUB, urls: ["gitlab.com"] };
    await unlockWith([login]);
    const response = await handleAutofill(
      { type: "autofill:suggest" },
      sender("https://gitlab.com/users/sign_in")!,
    );
    expect(response).toMatchObject({ suggestions: [{ id: GITHUB.id }] });
  });

  it("keeps a host-only login to its exact host", async () => {
    const login = { ...GITHUB, url: "https://gist.github.com", urlMatch: "host" as const };
    await unlockWith([login]);
    const elsewhere = await handleAutofill(
      { type: "autofill:suggest" },
      sender("https://github.com/")!,
    );
    expect(elsewhere).toMatchObject({ suggestions: [] });
    const exact = await handleAutofill(
      { type: "autofill:suggest" },
      sender("https://gist.github.com/login")!,
    );
    expect(exact).toMatchObject({ suggestions: [{ id: GITHUB.id }] });
  });

  it("never fills an item that is not a login, even on its site", async () => {
    const wifi = { ...GITHUB, id: "00000000-0000-4000-8000-0000000000f1", type: "wifi" as const };
    await unlockWith([wifi]);
    const response = await handleAutofill(
      { type: "autofill:fill", id: wifi.id },
      sender("https://github.com/login")!,
    );
    expect(response).toEqual({ ok: false, error: "no_match" });
  });

  it("refuses to fill another domain's login even when asked for its id", async () => {
    await unlockWith([GITHUB, EVIL]);
    const response = await handleAutofill(
      { type: "autofill:fill", id: EVIL.id },
      sender("https://github.com/login")!,
    );
    expect(response).toEqual({ ok: false, error: "no_match" });
  });

  it("keeps tenants of shared hosting apart", async () => {
    await unlockWith([PAGES]);
    const response = await handleAutofill(
      { type: "autofill:fill", id: PAGES.id },
      sender("https://mallory.github.io/")!,
    );
    expect(response).toEqual({ ok: false, error: "no_match" });
  });

  it("returns the credentials of a matching login", async () => {
    await unlockWith([GITHUB]);
    const response = await handleAutofill(
      { type: "autofill:fill", id: GITHUB.id },
      sender("https://github.com/login")!,
    );
    expect(response).toEqual({
      ok: true,
      credentials: { username: GITHUB.username, password: GITHUB.password },
    });
  });
});

describe("last used", () => {
  const WORK = {
    id: "00000000-0000-4000-8000-000000000004",
    title: "GitHub work",
    url: "github.com",
    username: "work@example.com",
    password: "work-password",
  };

  it("records a fill without touching the modified date and suggests it first next time", async () => {
    await unlockFresh([GITHUB, WORK]);
    const page = sender("https://github.com/login")!;
    const before = await handleAutofill({ type: "autofill:suggest" }, page);
    expect(before).toMatchObject({ suggestions: [{ id: GITHUB.id }, { id: WORK.id }] });

    const [, workBefore] = await decryptAll(key);
    const cachedRow = (localArea.get("items") as { id: string; updatedAt: number }[]).find(
      (row) => row.id === WORK.id,
    )!;
    await handleAutofill({ type: "autofill:fill", id: WORK.id }, page);
    await settled(() => puts.length > 0);
    await settled(() => {
      const row = (localArea.get("items") as { id: string; updatedAt: number }[]).find(
        (cached) => cached.id === WORK.id,
      );
      return row !== undefined && row.updatedAt !== cachedRow.updatedAt;
    });
    expect(puts).toEqual([WORK.id]);
    expect(conditions).toEqual([String(cachedRow.updatedAt)]);
    const work = (await decryptAll(key)).find((item) => item.id === WORK.id)!;
    expect(work.lastUsedAt).toBeGreaterThan(0);
    expect(work.updatedAt).toBe(workBefore!.updatedAt);

    expect(await handleAutofill({ type: "autofill:suggest" }, page)).toMatchObject({
      suggestions: [{ id: WORK.id }, { id: GITHUB.id }],
    });
  });

  it("writes at most once a minute per item", async () => {
    await unlockWith([GITHUB]);
    const page = sender("https://github.com/login")!;
    await handleAutofill({ type: "autofill:fill", id: GITHUB.id }, page);
    await settled(() => puts.length > 0);
    await settled();
    await handleAutofill({ type: "autofill:fill", id: GITHUB.id }, page);
    await settled();
    expect(puts).toEqual([GITHUB.id]);
  });

  it("never brings back an item another device deleted", async () => {
    await unlockFresh([GITHUB]);
    remote.changes = [
      {
        id: GITHUB.id,
        ciphertext: null,
        nonce: null,
        updatedAt: 9_999_999_999,
        deletedAt: 9_999_999_999,
      },
    ];
    await handleAutofill({ type: "autofill:fill", id: GITHUB.id }, sender("https://github.com/")!);
    await settled();
    expect(puts).toEqual([]);
  });

  it("leaves a newer version on the server alone", async () => {
    await unlockFresh([GITHUB]);
    remote.conflict = true;
    const before = localArea.get("items");
    await handleAutofill({ type: "autofill:fill", id: GITHUB.id }, sender("https://github.com/")!);
    await settled();
    expect(puts).toEqual([]);
    expect(localArea.get("items")).toEqual(before);
  });
});

describe("capture and save", () => {
  it("offers to save a new login and stores it on save", async () => {
    await unlockWith([]);
    const page = sender("https://news.example.com/signup")!;
    const captured = await handleAutofill(
      { type: "autofill:capture", username: "reader", password: "fresh-password" },
      page,
    );
    expect(captured).toEqual({
      ok: true,
      prompt: { domain: "example.com", username: "reader", update: false, confirmed: false },
    });

    expect(await handleAutofill({ type: "autofill:pending" }, page)).toEqual(captured);
    expect(await handleAutofill({ type: "autofill:confirm" }, page)).toEqual({
      ok: true,
      prompt: { domain: "example.com", username: "reader", update: false, confirmed: true },
    });
    expect(await handleAutofill({ type: "autofill:save" }, page)).toEqual({
      ok: true,
      saved: true,
    });
    expect(puts).toHaveLength(1);

    const [saved] = await decryptAll(key);
    expect(saved).toMatchObject({
      title: "example.com",
      url: "example.com",
      username: "reader",
      password: "fresh-password",
    });
    expect(await handleAutofill({ type: "autofill:pending" }, page)).toEqual({
      ok: true,
      prompt: null,
    });
  });

  it("stays quiet when the submitted password is already saved", async () => {
    await unlockWith([GITHUB]);
    const response = await handleAutofill(
      { type: "autofill:capture", username: GITHUB.username, password: GITHUB.password },
      sender("https://github.com/session")!,
    );
    expect(response).toEqual({ ok: true, prompt: null });
  });

  it("offers an update for a changed password and rewrites the same item", async () => {
    await unlockWith([GITHUB]);
    const page = sender("https://github.com/settings/password")!;
    const captured = await handleAutofill(
      { type: "autofill:capture", username: GITHUB.username, password: "rotated-password" },
      page,
    );
    expect(captured).toMatchObject({ prompt: { update: true } });

    await handleAutofill({ type: "autofill:save" }, page);
    expect(puts).toEqual([GITHUB.id]);
    const [updated] = await decryptAll(key);
    expect(updated).toMatchObject({ id: GITHUB.id, password: "rotated-password" });
    expect(updated?.passwordHistory).toEqual([
      { password: GITHUB.password, changedAt: expect.any(Number) },
    ]);
  });

  it("does not carry a pending save over to a different site", async () => {
    await unlockWith([]);
    await handleAutofill(
      { type: "autofill:capture", username: "u", password: "p" },
      sender("https://one.example.com/")!,
    );
    expect(
      await handleAutofill({ type: "autofill:pending" }, sender("https://another-site.com/")!),
    ).toEqual({ ok: true, prompt: null });
  });

  it("forgets an unconfirmed capture after a minute but keeps a confirmed one longer", async () => {
    vi.useFakeTimers();
    try {
      await unlockWith([]);
      const page = sender("https://example.com/login")!;
      await handleAutofill({ type: "autofill:capture", username: "u", password: "typo" }, page);
      vi.advanceTimersByTime(61_000);
      expect(await handleAutofill({ type: "autofill:pending" }, page)).toEqual({
        ok: true,
        prompt: null,
      });
      expect(await handleAutofill({ type: "autofill:confirm" }, page)).toEqual({
        ok: true,
        prompt: null,
      });

      await handleAutofill({ type: "autofill:capture", username: "u", password: "right" }, page);
      await handleAutofill({ type: "autofill:confirm" }, page);
      vi.advanceTimersByTime(4 * 60_000);
      expect(await handleAutofill({ type: "autofill:pending" }, page)).toMatchObject({
        prompt: { confirmed: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks to unlock instead of saving while locked", async () => {
    const page = sender("https://example.com/login")!;
    await handleAutofill({ type: "autofill:capture", username: "u", password: "p" }, page);
    expect(await handleAutofill({ type: "autofill:save" }, page)).toEqual({
      ok: true,
      saved: false,
      locked: true,
    });
    expect(openPopup).toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });
});

describe("without the scripting API", () => {
  it("reports autofill as unavailable instead of throwing", async () => {
    const { autofillSupported, isAutofillEnabled, enableAutofill } =
      await import("../extension/lib/autofill-permission.js");
    expect(autofillSupported()).toBe(false);
    await expect(isAutofillEnabled()).resolves.toBe(false);
    await expect(enableAutofill()).resolves.toBe(false);
  });
});
