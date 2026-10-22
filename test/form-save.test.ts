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

const tabMessages: { tabId: number; message: unknown; frameId?: number }[] = [];
vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  action: { openPopup: vi.fn(async () => {}) },
  tabs: {
    sendMessage: vi.fn(async (tabId: number, message: unknown, options?: { frameId?: number }) => {
      tabMessages.push({ tabId, message, frameId: options?.frameId });
    }),
  },
});

const puts: string[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/items" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ serverTime: Math.floor(Date.now() / 1000), items: [] }));
    }
    if (url.pathname === "/api/vaults") {
      return new Response(JSON.stringify({ vaults: [] }));
    }
    const id = url.pathname.split("/").pop()!;
    puts.push(id);
    return new Response(JSON.stringify({ id, updatedAt: Math.floor(Date.now() / 1000) + 1 }));
  }),
);

const { handleAutofill, trustedSender } = await import("../extension/lib/autofill-service.js");
const { rememberCardFrame } = await import("../extension/lib/card-frames.js");
const { rememberFrameCard } = await import("../extension/lib/form-save.js");
const { saveItem } = await import("../extension/lib/vault/store.js");
const { decryptAll } = await import("../extension/lib/vault/decrypt.js");

const EXTENSION_ID = "vault-extension";

function sender(url: string) {
  return trustedSender(
    { id: EXTENSION_ID, frameId: 0, url, tab: { id: 7 } as chrome.tabs.Tab },
    EXTENSION_ID,
  )!;
}

let key: CryptoKey;

async function unlockWith(items: Parameters<typeof saveItem>[1][]) {
  const raw = createVaultKey();
  key = await importVaultKey(raw);
  localArea.set("apiUrl", "https://vault.test");
  localArea.set("unboundItemsMigrated", true);
  sessionArea.set("vaultKeyRaw", toBase64(raw));
  sessionArea.set("token", "session-token");
  for (const item of items) {
    await saveItem(key, item);
  }
  puts.length = 0;
}

const CARD = {
  id: "00000000-0000-4000-8000-0000000000c1",
  type: "card" as const,
  title: "Everyday Visa",
  cardholder: "Jane Doe",
  cardNumber: "4242424242424242",
  cardExpiry: "08/29",
};
const HOME = {
  id: "00000000-0000-4000-8000-0000000000a1",
  type: "identity" as const,
  title: "Home",
  fullName: "Nguyễn Văn An",
  phone: "090 123 4567",
  address: "12 Nguyễn Huệ",
  city: "Quận 1",
  country: "Việt Nam",
};
const GITHUB = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "GitHub",
  url: "github.com",
  username: "me@example.com",
  password: "github-password",
};

const SHOP = "https://shop.example.com/checkout";

beforeEach(() => {
  localArea.clear();
  sessionArea.clear();
  puts.length = 0;
  tabMessages.length = 0;
});

describe("saving typed cards", () => {
  it("asks to save a new card and stores it without the CVV by default", async () => {
    await unlockWith([]);
    const page = sender(SHOP);
    const captured = await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4111 1111 1111 1111", expiry: "0130", cvv: "321", cardholder: "Jo" },
        untouched: false,
      },
      page,
    );
    expect(captured).toEqual({
      ok: true,
      form: {
        kind: "card",
        domain: "example.com",
        update: false,
        brand: "visa",
        last4: "1111",
        expiry: "01/30",
        hasCvv: true,
      },
    });
    expect(await handleAutofill({ type: "autofill:form-pending" }, page)).toEqual(captured);
    expect(await handleAutofill({ type: "autofill:form-save" }, page)).toEqual({
      ok: true,
      saved: true,
    });
    const [saved] = await decryptAll(key);
    expect(saved).toMatchObject({
      type: "card",
      title: "Visa •••• 1111",
      cardNumber: "4111111111111111",
      cardExpiry: "01/30",
      cardholder: "Jo",
    });
    expect(saved!.cardCvv).toBeUndefined();
    expect(await handleAutofill({ type: "autofill:form-pending" }, page)).toEqual({
      ok: true,
      form: null,
    });
  });

  it("stores the CVV only when the box is ticked", async () => {
    await unlockWith([]);
    const page = sender(SHOP);
    await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4111111111111111", cvv: "321" },
        untouched: false,
      },
      page,
    );
    await handleAutofill({ type: "autofill:form-save", cvv: true }, page);
    const [saved] = await decryptAll(key);
    expect(saved!.cardCvv).toBe("321");
  });

  it("stays quiet for a card that is already saved unchanged", async () => {
    await unlockWith([CARD]);
    const response = await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4242424242424242", expiry: "08/29" },
        untouched: false,
      },
      sender(SHOP),
    );
    expect(response).toEqual({ ok: true, form: null });
  });

  it("offers an update for a new expiry and rewrites the same card", async () => {
    await unlockWith([CARD]);
    const page = sender(SHOP);
    const response = await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4242424242424242", expiry: "09/31" },
        untouched: false,
      },
      page,
    );
    expect(response).toMatchObject({ form: { kind: "card", update: true, last4: "4242" } });
    await handleAutofill({ type: "autofill:form-save" }, page);
    const items = await decryptAll(key);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: CARD.id, title: "Everyday Visa", cardExpiry: "09/31" });
  });

  it("ignores a card 7key filled itself and invalid numbers", async () => {
    await unlockWith([]);
    const page = sender(SHOP);
    expect(
      await handleAutofill(
        { type: "autofill:form-capture", card: { number: "4111111111111111" }, untouched: true },
        page,
      ),
    ).toEqual({ ok: true, form: null });
    expect(
      await handleAutofill(
        { type: "autofill:form-capture", card: { number: "1234567812345678" }, untouched: false },
        page,
      ),
    ).toEqual({ ok: true, form: null });
  });

  it("never asks on localhost or plain http", async () => {
    await unlockWith([]);
    const local = await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4111111111111111" },
        untouched: false,
      },
      sender("http://localhost:5173/pay"),
    );
    expect(local).toEqual({ ok: true, form: null });
  });

  it("stops asking on a site after never, and only on that site", async () => {
    await unlockWith([]);
    const page = sender(SHOP);
    const capture = {
      type: "autofill:form-capture" as const,
      card: { number: "4111111111111111" },
      untouched: false,
    };
    await handleAutofill(capture, page);
    await handleAutofill({ type: "autofill:form-dismiss", never: true }, page);
    expect(localArea.get("neverAskForms")).toEqual(["example.com"]);
    expect(await handleAutofill(capture, sender("https://pay.example.com/"))).toEqual({
      ok: true,
      form: null,
    });
    expect(await handleAutofill(capture, sender("https://other.test/"))).toMatchObject({
      form: { kind: "card" },
    });
  });

  it("asks to unlock instead of saving while locked", async () => {
    const page = sender(SHOP);
    await handleAutofill(
      {
        type: "autofill:form-capture",
        card: { number: "4111111111111111" },
        untouched: false,
      },
      page,
    );
    expect(await handleAutofill({ type: "autofill:form-save" }, page)).toEqual({
      ok: true,
      saved: false,
      locked: true,
    });
  });
});

describe("cards typed inside payment frames", () => {
  const frameSender = (frameId: number) => ({
    id: EXTENSION_ID,
    frameId,
    documentId: `doc-${frameId}`,
    url: "https://js.stripe.com/v3/elements-inner-card.html",
    tab: { id: 7, url: SHOP } as chrome.tabs.Tab,
  });

  it("merges parts from registered frames into the top frame's prompt", async () => {
    await unlockWith([]);
    await rememberCardFrame(frameSender(3), EXTENSION_ID);
    await rememberCardFrame(frameSender(4), EXTENSION_ID);
    await rememberFrameCard(frameSender(3), EXTENSION_ID, {
      type: "autofill:card-frame-capture",
      card: { number: "4111111111111111" },
      untouched: false,
      submit: false,
    });
    await rememberFrameCard(frameSender(4), EXTENSION_ID, {
      type: "autofill:card-frame-capture",
      card: { expiry: "01/30", cvv: "321" },
      untouched: false,
      submit: true,
    });
    expect(tabMessages).toEqual([{ tabId: 7, message: { type: "7key:form-capture" }, frameId: 0 }]);
    const response = await handleAutofill(
      { type: "autofill:form-capture", card: { cardholder: "Jo" }, untouched: true },
      sender(SHOP),
    );
    expect(response).toMatchObject({
      form: { kind: "card", last4: "1111", expiry: "01/30", hasCvv: true },
    });
  });

  it("ignores frames that never registered", async () => {
    await unlockWith([]);
    await rememberFrameCard(frameSender(9), EXTENSION_ID, {
      type: "autofill:card-frame-capture",
      card: { number: "4111111111111111" },
      untouched: false,
      submit: true,
    });
    expect(tabMessages).toEqual([]);
    expect(await handleAutofill({ type: "autofill:form-capture", card: {} }, sender(SHOP))).toEqual(
      { ok: true, form: null },
    );
  });
});

describe("saving addresses", () => {
  it("asks to save a typed address with a one-line preview", async () => {
    await unlockWith([HOME]);
    const page = sender(SHOP);
    const response = await handleAutofill(
      {
        type: "autofill:form-capture",
        address: {
          fullName: "Trần Bình",
          address: "5 Hai Bà Trưng",
          city: "Hà Nội",
          country: "VN",
        },
      },
      page,
    );
    expect(response).toEqual({
      ok: true,
      form: {
        kind: "address",
        domain: "example.com",
        update: false,
        preview: "Trần Bình · 5 Hai Bà Trưng · Hà Nội",
        country: "VN",
      },
    });
    await handleAutofill({ type: "autofill:form-save" }, page);
    const saved = (await decryptAll(key)).find((item) => item.id !== HOME.id);
    expect(saved).toMatchObject({ type: "identity", title: "Trần Bình", city: "Hà Nội" });
    expect(saved!.url).toBeUndefined();
  });

  it("stays quiet for a saved address and offers an update when it changed", async () => {
    await unlockWith([HOME]);
    const page = sender(SHOP);
    expect(
      await handleAutofill(
        {
          type: "autofill:form-capture",
          address: { fullName: "nguyen van an", address: "12 Nguyen Hue", city: "Quận 1" },
        },
        page,
      ),
    ).toEqual({ ok: true, form: null });
    expect(
      await handleAutofill(
        {
          type: "autofill:form-capture",
          address: { fullName: "Nguyễn Văn An", address: "12 Nguyễn Huệ", postalCode: "700001" },
        },
        page,
      ),
    ).toMatchObject({ form: { kind: "address", update: true } });
  });
});

describe("random details remembered per site", () => {
  it("keeps a random identity for the site and suggests it first there", async () => {
    await unlockWith([HOME]);
    const page = sender(SHOP);
    const response = await handleAutofill(
      {
        type: "autofill:form-capture",
        address: { fullName: "Alex Rivera", email: "alex@example.com", phone: "555 0100" },
        random: true,
      },
      page,
    );
    expect(response).toMatchObject({
      form: { kind: "address", random: true, update: false, domain: "example.com" },
    });
    await handleAutofill({ type: "autofill:form-save" }, page);
    const saved = (await decryptAll(key)).find((item) => item.id !== HOME.id)!;
    expect(saved).toMatchObject({ type: "identity", title: "example.com", url: "example.com" });

    const here = await handleAutofill({ type: "autofill:identities" }, page);
    expect(here).toMatchObject({ identities: [{ id: saved.id }, { id: HOME.id }] });
  });
});

describe("lookalike check", () => {
  it("warns on a lookalike of a saved login and not on the real site", async () => {
    await unlockWith([GITHUB, CARD]);
    expect(
      await handleAutofill({ type: "autofill:site-check" }, sender("https://githbu.com/login")),
    ).toEqual({ ok: true, lookalike: { kind: "lookalike", target: "github.com", reason: "typo" } });
    expect(
      await handleAutofill({ type: "autofill:site-check" }, sender("https://github.com/login")),
    ).toEqual({ ok: true, lookalike: null });
  });

  it("says nothing while locked", async () => {
    expect(
      await handleAutofill({ type: "autofill:site-check" }, sender("https://githbu.com/login")),
    ).toEqual({ ok: true, lookalike: null });
  });
});
