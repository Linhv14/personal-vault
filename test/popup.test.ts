// @vitest-environment happy-dom

/**
 * Smoke test for the extension popup: the real popup.html, driven against
 * stubbed `chrome.*` APIs and a fake server.
 *
 * The point is not to exercise every button but to catch what typechecking
 * cannot: missing ids in the HTML, screens wired in the wrong order, and above
 * all a key or plaintext landing in `storage.local`, which is on disk.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const EMAIL = "test@example.com";
const PASSWORD = "a long master password for tests";
const API_URL = "https://vault.test";
const REGISTRATION_TOKEN = "test-registration-token";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const ITEM_PASSWORD = "a-very-secret-password-123";

const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return Object.fromEntries(store);
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
    }),
    clear: vi.fn(async () => store.clear()),
    remove: vi.fn(async (key: string) => void store.delete(key)),
  };
}

const chromeMock = {
  storage: { local: area(localArea), session: area(sessionArea) },
  tabs: {
    query: vi.fn(async () => [{ url: "https://github.com/settings" }]),
    captureVisibleTab: vi.fn(),
  },
  permissions: {
    request: vi.fn(async () => true),
    contains: vi.fn(async () => false),
    remove: vi.fn(async () => true),
  },
  scripting: {
    getRegisteredContentScripts: vi.fn(async () => []),
    registerContentScripts: vi.fn(async () => {}),
    unregisterContentScripts: vi.fn(async () => {}),
  },
  alarms: { create: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    getManifest: () => ({ version: "0.0.0-test" }),
  },
};

const server = {
  account: null as Record<string, unknown> | null,
  items: new Map<string, { ciphertext: string; nonce: string; updatedAt: number }>(),
  /** Every request body seen, used to prove the server never gets plaintext. */
  received: [] as string[],
  emailVerification: false,
  shareRequests: [] as Record<string, any>[],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : {};
  if (init?.body) server.received.push(String(init.body));

  const now = Math.floor(Date.now() / 1000);

  if (url.pathname === "/api/auth/register") {
    if (new Headers(init?.headers).get("X-Registration-Token") !== REGISTRATION_TOKEN) {
      return json({ code: "auth.bad_registration_token", error: "Invalid token" }, 403);
    }
    server.account = body;
    return json({ accountId: "acc-1", token: "session-token", expiresAt: now + 3600 }, 201);
  }

  if (url.pathname === "/api/auth/prelogin") {
    return json({
      kdf: server.account?.kdf ?? { type: "pbkdf2-sha256", iterations: 600000, salt: "AAAA" },
    });
  }

  if (url.pathname === "/api/auth/login") {
    if (!server.account || body.authKey !== server.account.authKey) {
      return json({ code: "auth.invalid_credentials", error: "Bad credentials" }, 401);
    }
    return json({
      token: "session-token",
      expiresAt: now + 3600,
      wrappedVaultKey: server.account.wrappedVaultKey,
    });
  }

  if (url.pathname === "/api/time") return json({ serverTime: now });

  if (url.pathname === "/api/config") {
    return json({ registration: "token", emailVerification: server.emailVerification });
  }

  if (url.pathname === "/api/items" && method === "GET") {
    return json({
      serverTime: now,
      items: [...server.items.entries()].map(([id, row]) => ({ id, ...row, deletedAt: null })),
    });
  }

  if (url.pathname.startsWith("/api/items/") && method === "PUT") {
    const id = url.pathname.split("/").pop()!;
    server.items.set(id, { ciphertext: body.ciphertext, nonce: body.nonce, updatedAt: now });
    return json({ id, updatedAt: now });
  }

  if (url.pathname === "/api/shares" && method === "POST") {
    server.shareRequests.push(body);
    return json({ id: "share-1", expiresAt: now + 86400, maxViews: body.maxViews }, 201);
  }

  return json({ code: "server.not_found", error: "No such endpoint" }, 404);
});

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in popup.html`);
  return node as T;
}

function visibleScreen(): string | null {
  for (const section of document.querySelectorAll("section[id^='screen-']")) {
    if (!(section as HTMLElement).hidden) return section.id;
  }
  return null;
}

function setField(form: HTMLFormElement, name: string, value: string): void {
  form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label} (visible screen: ${visibleScreen()})`);
}

describe("extension popup", () => {
  beforeAll(async () => {
    const html = readFileSync(
      path.resolve(import.meta.dirname, "../extension/popup/popup.html"),
      "utf8",
    );
    document.body.innerHTML = html
      .replace(/[\s\S]*<body>/, "")
      .replace(/<\/body>[\s\S]*/, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");

    vi.stubGlobal("chrome", chromeMock);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "") },
    });

    await import("../extension/popup/popup.js");
  });

  it("shows the setup screen when nothing is configured", async () => {
    await waitFor(() => visibleScreen() === "screen-setup", "the setup screen");
  });

  it("fills static text from the message catalogue", () => {
    // A blank label means an element is missing its data-i18n key or the key is
    // misspelled — invisible to the typechecker.
    for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      expect(node.textContent?.trim(), node.dataset.i18n).not.toBe("");
    }
  });

  it("creates a vault and lands on the list", async () => {
    const form = el<HTMLFormElement>("form-setup");
    setField(form, "apiUrl", API_URL);
    setField(form, "email", EMAIL);
    setField(form, "registrationToken", REGISTRATION_TOKEN);
    setField(form, "password", PASSWORD);
    setField(form, "confirm", PASSWORD);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => visibleScreen() === "screen-list", "the item list");
    expect(server.account).not.toBeNull();
  });

  it("signs up without asking for any browser permission", () => {
    // A permission prompt closes the popup, which used to abort the first sign-in.
    expect(chromeMock.permissions.request).not.toHaveBeenCalled();
  });

  it("keeps the vault key in session storage, never in local storage", () => {
    // The central invariant: storage.local is on disk in the clear.
    expect(sessionArea.get("vaultKeyRaw")).toBeTypeOf("string");
    expect(localArea.has("vaultKeyRaw")).toBe(false);

    const localDump = JSON.stringify(Object.fromEntries(localArea));
    expect(localDump).not.toContain(PASSWORD);
    expect(localDump).not.toContain(sessionArea.get("vaultKeyRaw"));
    expect(localArea.has("token")).toBe(false);
    expect(sessionArea.get("token")).toBe("session-token");
  });

  function addItemOfKind(kind: string): void {
    el("btn-add").dispatchEvent(new Event("click", { bubbles: true }));
    const option = [...el("add-menu").querySelectorAll<HTMLButtonElement>(".add-option")].find(
      (button) => button.textContent === kind,
    );
    if (!option) throw new Error(`No "${kind}" in the add menu`);
    option.click();
  }

  it("saves an item with a 2FA secret, sending only ciphertext", async () => {
    addItemOfKind("Login");
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");

    const form = el<HTMLFormElement>("form-edit");
    setField(form, "title", "GitHub");
    setField(form, "url", "github.com");
    setField(form, "username", "user@example.com");
    setField(form, "password", ITEM_PASSWORD);
    setField(form, "totp", TOTP_SECRET);
    setField(form, "note", "Recovery codes are in the safe");

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => visibleScreen() === "screen-list", "the list after saving");

    expect(server.items.size).toBe(1);

    const sent = server.received.join("\n");
    expect(sent).not.toContain("GitHub");
    expect(sent).not.toContain("github.com");
    expect(sent).not.toContain(ITEM_PASSWORD);
    expect(sent).not.toContain(TOTP_SECRET);
  });

  it("surfaces the item under the matching-domain heading", async () => {
    await waitFor(() => !el("matching-section").hidden, "the domain match section");
    expect(el("matching-title").textContent).toContain("github.com");
    expect(el("matching-list").textContent).toContain("GitHub");
    const labels = [...el("matching-list").querySelectorAll(".item-head button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Copy 2FA code", "Copy password"]);
  });

  it("renders a live 2FA code that matches an independent computation", async () => {
    el("matching-list")
      .querySelector<HTMLElement>(".item-head")!
      .dispatchEvent(new Event("click", { bubbles: true }));

    await waitFor(
      () => /\d{3} \d{3}/.test(el("matching-list").querySelector(".totp-code")?.textContent ?? ""),
      "the 2FA code",
    );

    const shown = el("matching-list").querySelector(".totp-code")!.textContent!.replace(" ", "");
    const { generateTotp } = await import("../src/core/totp.js");
    expect(shown).toBe(await generateTotp({ secret: TOTP_SECRET }));
  });

  async function openShareScreen(): Promise<void> {
    el("share-back").click();
    await waitFor(() => visibleScreen() === "screen-list", "the list");
    el("matching-list").querySelector<HTMLElement>(".item-head")!.click();
    const shareButton = [...el("matching-list").querySelectorAll("button")].find(
      (button) => button.textContent === "Share",
    )!;
    shareButton.dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(
      () => visibleScreen() === "screen-share" && el("share-result").hidden,
      "the share screen",
    );
  }

  it("creates a share link without sending the key to the server", async () => {
    await openShareScreen();

    el<HTMLFormElement>("form-share").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !el("share-result").hidden, "the generated link");

    const url = el<HTMLInputElement>("share-url").value;
    expect(url).toMatch(/^https:\/\/vault\.test\/s\/share-1#[A-Za-z0-9_-]+$/);

    const fragment = url.split("#")[1]!;
    expect(server.received.join("\n")).not.toContain(fragment);
  });

  it("shares the website, username, password and 2FA, never the note", async () => {
    await openShareScreen();
    expect(el("share-fields").textContent).toContain("2FA code");
    expect(el("share-fields").textContent).not.toContain("Note");
    expect(el("share-totp-hint").hidden).toBe(false);

    server.shareRequests.length = 0;
    el<HTMLFormElement>("form-share").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !el("share-result").hidden, "the generated link");

    const fragment = el<HTMLInputElement>("share-url").value.split("#")[1]!;
    const { openShare } = await import("../src/core/share.js");
    const payload = await openShare(fragment, server.shareRequests[0] as never);
    expect(payload).toMatchObject({ url: "github.com", password: ITEM_PASSWORD });
    expect(payload.totp?.secret).toBe(TOTP_SECRET);
    expect(payload.note).toBeUndefined();
  });

  it("keeps a link for several recipients open until it expires", async () => {
    server.emailVerification = true;
    await openShareScreen();
    el("form-share").querySelector<HTMLInputElement>('[name="access"][value="emails"]')!.click();
    expect(el("share-recipients-field").hidden).toBe(false);

    const entry = el<HTMLInputElement>("share-recipient-entry");
    entry.value = "a@example.com, b@example.com not-an-email";
    entry.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(el("share-recipients").querySelectorAll(".chip")).toHaveLength(2);
    expect(entry.value).toBe("not-an-email");
    expect(el("share-recipients").getAttribute("aria-invalid")).toBe("true");

    const views = (value: string) =>
      el("form-share").querySelector<HTMLInputElement>(`[name="maxViews"][value="${value}"]`)!;
    expect(views("1").disabled).toBe(true);
    expect(views("unlimited").checked).toBe(true);
    expect(el("share-views-hint").hidden).toBe(false);

    entry.value = "";
    server.shareRequests.length = 0;
    el<HTMLFormElement>("form-share").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !el("share-result").hidden, "the generated link");
    expect(server.shareRequests[0]).toMatchObject({
      maxViews: null,
      recipients: ["a@example.com", "b@example.com"],
    });
    server.emailVerification = false;
  });

  it("saves a card under its own type, checking the expiry", async () => {
    el("share-back").click();
    await waitFor(() => visibleScreen() === "screen-list", "the list");
    addItemOfKind("Card");
    await waitFor(() => visibleScreen() === "screen-edit", "the card editor");
    expect(el("edit-title").textContent).toBe("New card");

    const form = el<HTMLFormElement>("form-edit");
    expect(form.querySelector('[name="password"]')).toBeNull();
    setField(form, "title", "Visa");
    setField(form, "cardNumber", "4242 4242 4242 4242");
    setField(form, "cardExpiry", "13/27");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(el("edit-error").textContent).toBe("Write the expiry as MM/YY.");

    setField(form, "cardExpiry", "4/2027");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => visibleScreen() === "screen-list", "the list after saving");
    expect(server.items.size).toBe(2);

    const chips = [...el("type-filter").querySelectorAll<HTMLButtonElement>(".type-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "All2",
      "Logins1",
      "Notes0",
      "Cards1",
      "Addresses0",
      "Recovery codes0",
      "Wi-Fi0",
      "API keys0",
      "SSH keys0",
      "Bank accounts0",
      "Documents0",
      "Licenses0",
    ]);
    chips.find((chip) => chip.textContent === "Wi-Fi0")!.click();
    expect(el("list-empty-type").hidden).toBe(false);
    expect(el("list-add-type").textContent).toBe("New Wi-Fi network");
    el("type-filter").querySelectorAll<HTMLButtonElement>(".type-chip")[3]!.click();
    expect(el("matching-section").hidden).toBe(true);
    expect(el("all-list").querySelectorAll(".item")).toHaveLength(1);
    expect(el("all-list").textContent).toContain("Ending in 4242");

    el("all-list").querySelector<HTMLElement>(".item-head")!.click();
    expect(el("all-list").querySelector(".item-body")!.textContent).toContain("04/27");
    el("type-filter").querySelector<HTMLButtonElement>(".type-chip")!.click();
  });

  it("clears session storage when locked, keeping the offline cache", async () => {
    el("btn-lock").dispatchEvent(new Event("click", { bubbles: true }));
    await waitFor(() => sessionArea.size === 0, "session storage to be cleared");
    expect(localArea.has("items")).toBe(true);
  });
});
