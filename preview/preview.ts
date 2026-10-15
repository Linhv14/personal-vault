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
import { enablePin } from "../extension/lib/pin.js";

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
    urls: ["gist.github.com"],
    fields: [
      { label: "Org", value: "acme-inc" },
      { label: "Recovery PIN", value: "482913", hidden: true },
    ],
    passwordHistory: [
      { password: "old-Password-1", changedAt: 1760000000 },
      { password: "older-Password-0", changedAt: 1750000000 },
    ],
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
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    type: "card",
    title: "Visa",
    cardholder: "NGUYEN VAN AN",
    cardNumber: "4111111111114417",
    cardExpiry: "08/28",
    cardCvv: "731",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    type: "identity",
    title: "Nhà",
    fullName: "Nguyễn Văn An",
    phone: "+84 912 345 678",
    address: "12 Lý Thái Tổ",
    city: "Hà Nội",
    country: "Việt Nam",
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    type: "recovery",
    title: "Google",
    codes: ["4821 0937", "1176 5402", "9034 2219", "5560 8813", "7742 1098", "3381 6624"],
  },
  {
    id: "88888888-8888-4888-8888-888888888888",
    type: "wifi",
    title: "Nhà - 5G",
    ssid: "HomeNet-5G",
    password: "maple-orbit-quartz-58",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "ssh",
    title: "MacBook",
    sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOm you@macbook",
    sshFingerprint: "SHA256:k3Yl0r8vQe7m2nB",
    sshPrivateKey:
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n-----END OPENSSH PRIVATE KEY-----",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    type: "bank",
    title: "Vietcombank",
    bankName: "Vietcombank",
    fullName: "NGUYEN VAN AN",
    accountNumber: "0011004417",
    swift: "BFTVVNVX",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    type: "note",
    title: "Số bảo hiểm",
    note: "BHXH: 0123456789\nNơi đăng ký: Hà Nội",
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
    async remove(key: string) {
      store.delete(key);
    },
  };
}

Object.assign(globalThis, {
  chrome: {
    storage: {
      local: area(local),
      session: area(session),
      onChanged: { addListener() {}, removeListener() {} },
    },
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
      async contains() {
        return false;
      },
      async remove() {
        return true;
      },
    },
    scripting: {
      async getRegisteredContentScripts() {
        return [];
      },
      async registerContentScripts() {},
      async unregisterContentScripts() {},
    },
    alarms: { async create() {}, onAlarm: { addListener() {} } },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getManifest: () => ({ version: "preview" }),
    },
  },
});

const realFetch = globalThis.fetch.bind(globalThis);
const pin = { verifier: "", key: toBase64(crypto.getRandomValues(new Uint8Array(32))) };

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
  if (url.pathname === "/api/logo") {
    return realFetch(`/logo?domain=${encodeURIComponent(url.searchParams.get("domain") ?? "")}`);
  }

  if (url.pathname === "/api/items") return json({ serverTime: now, items: [] });
  if (url.pathname === "/api/items/batch") {
    const { items } = JSON.parse(String(init?.body ?? "{}")) as { items: { id: string }[] };
    return json({ updatedAt: now, created: items.map(({ id }) => id) });
  }
  if (url.pathname.startsWith("/api/items/")) {
    return json({ id: url.pathname.split("/").pop(), updatedAt: now });
  }
  if (url.pathname === "/api/auth/pin" && init?.method === "PUT") {
    pin.verifier = (JSON.parse(String(init.body)) as { verifier: string }).verifier;
    return json({ pinKey: pin.key });
  }
  if (url.pathname === "/api/auth/pin" && init?.method === "DELETE") {
    pin.verifier = "";
    return json({ ok: true });
  }
  if (url.pathname === "/api/auth/pin/unlock") {
    const { verifier } = JSON.parse(String(init?.body ?? "{}")) as { verifier: string };
    if (pin.verifier && verifier === pin.verifier) return json({ pinKey: pin.key });
    return json({ code: "auth.pin_wrong", error: "Wrong PIN", params: { count: 4 } }, 403);
  }
  if (url.pathname === "/api/orgs") return json({ orgs: [] });
  if (url.pathname === "/api/invites") {
    const invited = new URLSearchParams(location.search).has("invite");
    return json({
      invites: invited
        ? [
            {
              id: "i1",
              orgId: "o1",
              orgName: "Acme Việt Nam",
              role: "member",
              expiresAt: now + 86_400,
            },
          ]
        : [],
    });
  }
  if (url.pathname === "/api/account/identity") {
    return init?.method === "PUT" ? json({ ok: true }) : json({ identity: null });
  }
  if (url.pathname === "/api/config") {
    return json({ registration: "open", emailVerification: true });
  }
  if (url.pathname === "/api/shares") {
    const id = `preview-${Math.random().toString(36).slice(2, 8)}`;
    return json({ id, expiresAt: now + 86_400, maxViews: 1, revokeToken: `revoke-${id}` }, 201);
  }
  if (url.pathname === "/api/shares/status") {
    const { shares } = JSON.parse(String(init?.body ?? "{}")) as { shares: { id: string }[] };
    return json({
      shares: shares.map(({ id }) => ({ id, active: true, expiresAt: now + 86_400, viewsLeft: 1 })),
    });
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
  } else {
    session.set("vaultKeyRaw", toBase64(vaultKeyRaw));
    session.set("token", "preview-token");
    session.set("lockAt", Date.now() + 3_600_000);
    const pinCode = params.get("pin");
    if (pinCode) await enablePin(pinCode, 1_000);
    if (params.get("bio")) {
      local.set("biometric", {
        token: "preview-token",
        credentialId: "AA",
        secret: toBase64(new Uint8Array(32)),
        sealed: { ciphertext: "AA", nonce: "AA" },
      });
    }
    if (screen === "unlock") session.clear();
  }
}

await seed();
if (location.pathname.startsWith("/import")) await import("../extension/import/main.js");
else await import("../extension/popup/main.js");
