/**
 * Runs the real popup in an ordinary browser tab for design review.
 *
 * The popup depends on `chrome.*` and a live Worker, neither of which exists
 * outside the extension, so both are stubbed here with in-memory doubles and a
 * seeded vault. Nothing in `extension/` is modified: this file imports the same
 * popup bundle that ships.
 */

import { importVaultKey, rewrapVaultKey, sealJson } from "../src/core/crypto.js";
import { toBase64 } from "../src/core/bytes.js";
import type { VaultItem } from "../extension/lib/vault.js";

const EMAIL = "you@example.com";
const PASSWORD = "preview-master-password";
const API_URL = "https://vault.example.com";

const SAMPLE_ITEMS: Omit<VaultItem, "createdAt" | "updatedAt">[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "GitHub",
    url: "github.com",
    username: "you@example.com",
    password: "7Qp!vR2xKm#4zLd9Wn",
    totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 30 },
    note: "Recovery codes are in the safe.",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Cloudflare",
    url: "dash.cloudflare.com",
    username: "you@example.com",
    password: "tG5$wQ8nZr3%hJx1",
    totp: { secret: "KRSXG5CTMVRXEZLU", algorithm: "SHA-1", digits: 6, period: 30 },
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Home router",
    url: "192.168.1.1",
    username: "admin",
    password: "amber-cargo-tulip-zone-ridge-vivid-pearl-month",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Bank",
    url: "example-bank.com",
    username: "0123456789",
    password: "Hs9#tN2vQw7!bXe4",
    totp: { secret: "MZXW6YTBOI======", algorithm: "SHA-1", digits: 6, period: 30 },
    note: "Card ending 4417.",
  },
];

const local = new Map<string, unknown>();
const session = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    async get(keys: string | string[] | null) {
      if (keys === null) return Object.fromEntries(store);
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    },
    async set(patch: Record<string, unknown>) {
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
    },
    async clear() {
      store.clear();
    },
  };
}

Object.assign(globalThis, {
  chrome: {
    storage: { local: area(local), session: area(session) },
    tabs: {
      // Pretend the user is on github.com so the "matching" section is visible.
      async query() {
        return [{ url: "https://github.com/settings/security" }];
      },
      async captureVisibleTab() {
        throw new Error("Tab capture is not available in the preview");
      },
    },
    permissions: {
      async request() {
        return true;
      },
    },
    alarms: { async create() {}, onAlarm: { addListener() {} } },
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  },
});

const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== new URL(API_URL).origin) return realFetch(input as RequestInfo, init);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const now = Math.floor(Date.now() / 1000);

  if (url.pathname === "/api/time") return json({ serverTime: now });
  if (url.pathname === "/api/items") return json({ serverTime: now, items: [] });
  if (url.pathname.startsWith("/api/items/")) {
    return json({ id: url.pathname.split("/").pop(), updatedAt: now });
  }
  if (url.pathname === "/api/shares") {
    return json({ id: "preview-share-id", expiresAt: now + 86_400, maxViews: 1 }, 201);
  }
  return json({ code: "server.not_found", error: "No such endpoint" }, 404);
}) as typeof fetch;

/** Seed an unlocked vault so the review starts on the item list. */
async function seed(): Promise<void> {
  // Mint the raw key here so the seeded session and the wrapped key in local
  // storage refer to the same vault key; `createAccount` returns a
  // non-extractable one, which cannot be placed into session storage.
  const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await importVaultKey(vaultKeyRaw);
  const record = await rewrapVaultKey(EMAIL, PASSWORD, vaultKeyRaw, 1_000);

  const items = await Promise.all(
    SAMPLE_ITEMS.map(async (item, index) => {
      const sealed = await sealJson(vaultKey, {
        ...item,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000 + index,
      });
      return {
        id: item.id,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        updatedAt: 1_700_000_000 + index,
        deletedAt: null,
      };
    }),
  );

  local.set("apiUrl", API_URL);
  local.set("email", EMAIL);
  local.set("kdf", record.kdf);
  local.set("wrappedVaultKey", record.wrappedVaultKey);
  local.set("items", items);
  local.set("lastSync", 1_700_000_100);

  const params = new URLSearchParams(location.search);
  if (params.get("locale")) local.set("locale", params.get("locale"));

  // `?screen=setup` or `?screen=unlock` to review the locked-out states.
  const screen = params.get("screen");
  if (screen === "setup") {
    local.delete("apiUrl");
    local.delete("email");
  } else if (screen !== "unlock") {
    session.set("vaultKeyRaw", toBase64(vaultKeyRaw));
    session.set("token", "preview-token");
    session.set("lockAt", Date.now() + 3_600_000);
  }
}

await seed();
await import("../extension/popup/popup.js");
