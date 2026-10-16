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
const RESUME_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

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
  logoRequests: [] as { domain: string; auth: string | null }[],
  sessionRevoked: false,
  invites: [
    { id: "invite-1", orgId: "org-1", orgName: "Acme", role: "member", expiresAt: 4_000_000_000 },
  ],
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
  if (url.pathname === "/api/orgs") return json({ orgs: [] });
  if (url.pathname === "/api/invites") return json({ invites: server.invites });
  if (url.pathname === "/api/account/identity") {
    return init?.method === "PUT" ? json({ ok: true }) : json({ identity: null });
  }

  if (url.pathname === "/api/auth/resume-key") {
    if (
      server.sessionRevoked ||
      new Headers(init?.headers).get("Authorization") !== "Bearer session-token"
    ) {
      return json({ code: "auth.unauthorized", error: "Not signed in" }, 401);
    }
    return json({ resumeKey: RESUME_KEY });
  }

  if (url.pathname === "/api/logo") {
    server.logoRequests.push({
      domain: url.searchParams.get("domain") ?? "",
      auth: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" },
    });
  }

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

  if (url.pathname.startsWith("/api/items/") && method === "DELETE") {
    server.items.delete(url.pathname.split("/").pop()!);
    return json({ deletedAt: now });
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
  const screen = document.body.dataset["screen"];
  return screen ? `screen-${screen}` : null;
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

    const { options } = await import("preact");
    options.debounceRendering = (render) => render();
    await import("../extension/popup/main.js");
  });

  it("shows the setup screen when nothing is configured", async () => {
    await waitFor(() => visibleScreen() === "screen-setup", "the setup screen");
  });

  it("labels every button from the message catalogue", () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>("#screen-setup button")) {
      const label = button.textContent?.trim() || button.getAttribute("aria-label");
      expect(label, button.outerHTML).toBeTruthy();
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

  it("points to a pending organization invitation", async () => {
    await waitFor(
      () =>
        [...document.querySelectorAll(".promo")].some((promo) =>
          promo.textContent?.includes("You're invited to Acme"),
        ),
      "the invitation banner",
    );
    const teams = el<HTMLButtonElement>("btn-teams");
    expect(teams.textContent).toBe("Organizations");
    expect(teams.querySelector(".teams-cta-dot")).not.toBeNull();
  });

  it("signs up without asking for any browser permission", () => {
    // A permission prompt closes the popup, which used to abort the first sign-in.
    expect(chromeMock.permissions.request).not.toHaveBeenCalled();
  });

  it("keeps the vault key in session storage, never in local storage", async () => {
    // The central invariant: storage.local is on disk in the clear.
    expect(sessionArea.get("vaultKeyRaw")).toBeTypeOf("string");
    expect(localArea.has("vaultKeyRaw")).toBe(false);
    expect(sessionArea.get("token")).toBe("session-token");

    await waitFor(() => localArea.has("resume"), "the sealed resume copy");
    const localDump = JSON.stringify(Object.fromEntries(localArea));
    expect(localDump).not.toContain(PASSWORD);
    expect(localDump).not.toContain(sessionArea.get("vaultKeyRaw"));
    expect(localDump).not.toContain(RESUME_KEY);
  });

  it("reopens the vault after a browser restart without the master password", async () => {
    const { resumeUnlock } = await import("../extension/lib/resume.js");
    const vaultKeyRaw = sessionArea.get("vaultKeyRaw");
    sessionArea.clear();
    expect(await resumeUnlock()).toBe(true);
    expect(sessionArea.get("vaultKeyRaw")).toBe(vaultKeyRaw);
    expect(sessionArea.get("token")).toBe("session-token");
  });

  function addItemOfKind(kind: string): void {
    el("btn-add").dispatchEvent(new Event("click", { bubbles: true }));
    const option = [...el("add-menu").querySelectorAll<HTMLButtonElement>(".menu-item")].find(
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

  function rows(listId: string): HTMLElement[] {
    return [...(document.getElementById(listId)?.querySelectorAll<HTMLElement>(".row") ?? [])];
  }

  function detailButton(label: string): HTMLButtonElement {
    const button = [...el("detail").querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.textContent === label || candidate.getAttribute("aria-label") === label,
    );
    if (!button) throw new Error(`No "${label}" button in the detail pane`);
    return button;
  }

  function typeOptions(): HTMLButtonElement[] {
    if (!document.querySelector(".dropdown .menu")) el("type-filter").click();
    return [...document.querySelectorAll<HTMLButtonElement>(".dropdown .menu .menu-item")];
  }

  function pickType(label: string): void {
    const option = typeOptions().find((candidate) => candidate.textContent === label);
    if (!option) throw new Error(`No "${label}" in the type filter`);
    option.click();
  }

  function drawerLinks(): HTMLButtonElement[] {
    if (!document.querySelector(".drawer")) el("btn-menu").click();
    return [...document.querySelectorAll<HTMLButtonElement>(".drawer-scopes .drawer-link")];
  }

  function scopes(): string[] {
    const labels = drawerLinks().map((link) => link.textContent ?? "");
    document.querySelector<HTMLElement>(".drawer-backdrop")?.click();
    return labels;
  }

  function openScope(label: string): void {
    const link = drawerLinks().find((candidate) => candidate.textContent?.startsWith(label));
    if (!link) throw new Error(`No "${label}" in the menu`);
    link.click();
  }

  it("surfaces the item under the matching-domain heading", async () => {
    await waitFor(() => rows("matching-list").length > 0, "the domain match section");
    expect(el("matching-title").textContent).toContain("github.com");
    expect(el("matching-list").textContent).toContain("GitHub");
    expect(rows("matching-list")[0]!.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows site logos fetched through the signed-in server", async () => {
    await waitFor(
      () => rows("matching-list")[0]?.querySelector(".site-logo img") !== null,
      "the logo",
    );
    expect(server.logoRequests[0]).toEqual({
      domain: "github.com",
      auth: "Bearer session-token",
    });
  });

  it("drops logos and their requests with website icons turned off", async () => {
    const { showLogos } = await import("../extension/popup/logos.js");
    server.logoRequests.length = 0;
    showLogos.value = false;
    expect(document.querySelector(".site-logo")).toBeNull();
    expect(rows("matching-list")[0]!.querySelector(".avatar")!.textContent).toBe("G");
    expect(server.logoRequests).toEqual([]);
    showLogos.value = true;
    await waitFor(() => document.querySelector(".site-logo") !== null, "the logo again");
  });

  it("renders a live 2FA code that matches an independent computation", async () => {
    rows("matching-list")[0]!.click();
    await waitFor(
      () => /\d{3} \d{3}/.test(el("detail").querySelector(".totp-code")?.textContent ?? ""),
      "the 2FA code",
    );
    const shown = el("detail").querySelector(".totp-code")!.textContent!.replace(" ", "");
    const { generateTotp } = await import("../src/core/totp.js");
    expect(shown).toBe(await generateTotp({ secret: TOTP_SECRET }));
  });

  async function openShareScreen(): Promise<void> {
    document.getElementById("share-back")?.click();
    await waitFor(() => visibleScreen() === "screen-list", "the list");
    rows("matching-list")[0]!.click();
    detailButton("Share").click();
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
    document.getElementById("share-back")?.click();
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

    expect(typeOptions().map((option) => option.textContent)).toEqual([
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
    pickType("Wi-Fi0");
    expect(el("list-empty-type").textContent).toContain("New Wi-Fi network");
    pickType("Cards1");
    expect(document.getElementById("matching-list")).toBeNull();
    expect(rows("all-list")).toHaveLength(1);
    expect(el("all-list").textContent).toContain("Ending in 4242");
    expect(el("detail").textContent).toContain("04/27");
  });

  it("favorites, tags and trashes an item, then restores or deletes it", async () => {
    detailButton("Add to favorites").click();
    await waitFor(() => scopes().includes("Favorites1"), "the favorite count");
    expect(rows("all-list")[0]!.querySelector(".favorite-mark")).not.toBeNull();

    detailButton("Edit").click();
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");
    const form = el<HTMLFormElement>("form-edit");
    setField(form, "tags", "travel, work, travel");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => scopes().includes("travel1"), "the tag links");
    expect(scopes()).toContain("work1");
    expect(el("detail").textContent).toContain("Card · travel · work");

    detailButton("More").click();
    [...document.querySelectorAll<HTMLButtonElement>(".more .menu-item")]
      .find((item) => item.textContent === "Move to trash")!
      .click();
    await waitFor(() => scopes().includes("Trash1"), "the trash count");
    expect(scopes()).toContain("Favorites0");
    expect(scopes()).not.toContain("travel1");

    openScope("Trash");
    expect(rows("all-list")).toHaveLength(1);
    detailButton("Restore").click();
    await waitFor(() => scopes().includes("Trash0"), "the restore");
    expect(scopes()).toContain("Favorites1");

    pickType("Cards1");
    detailButton("Edit").click();
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");
    el("edit-delete").click();
    await waitFor(() => scopes().includes("Trash1"), "the trash count");
    openScope("Trash");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    detailButton("Delete forever").click();
    await waitFor(() => scopes().includes("Trash0"), "the permanent delete");
    confirm.mockRestore();
    expect(server.items.size).toBe(1);
    expect(scopes()).toContain("All items1");
  });

  it("marks recovery codes used without revealing them", async () => {
    addItemOfKind("Recovery codes");
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");
    const form = el<HTMLFormElement>("form-edit");
    setField(form, "title", "Google");
    form.querySelector<HTMLTextAreaElement>('[name="codes"]')!.value = "1111 2222\n3333 4444";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => visibleScreen() === "screen-list", "the list after saving");
    pickType("Recovery codes1");
    await waitFor(() => el("detail").querySelectorAll(".code").length === 2, "the codes");

    expect(el("detail").textContent).not.toContain("1111");
    expect(rows("all-list")[0]!.textContent).toContain("2 codes");
    detailButton("Mark as used").click();
    await waitFor(() => el("detail").textContent!.includes("1 of 2 left"), "the used mark");
    expect(el("detail").querySelector(".code.used")).not.toBeNull();
    expect(rows("all-list")[0]!.textContent).toContain("1 of 2 left");
  });

  function vaultMenuItem(label: string): HTMLButtonElement {
    if (!document.querySelector(".vault-menu")) el("vault-menu").click();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu .menu-item")].find(
      (candidate) => candidate.textContent?.startsWith(label),
    );
    if (!item) throw new Error(`No "${label}" in the vault menu`);
    return item;
  }

  function vaultActions(name: string): void {
    if (!document.querySelector(".vault-menu")) el("vault-menu").click();
    const row = [...document.querySelectorAll<HTMLElement>(".vault-row")].find((candidate) =>
      candidate.textContent?.startsWith(name),
    );
    if (!row) throw new Error(`No vault "${name}"`);
    row.querySelector<HTMLButtonElement>(".vault-more")!.click();
  }

  async function addNote(title: string): Promise<void> {
    addItemOfKind("Note");
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");
    const form = el<HTMLFormElement>("form-edit");
    setField(form, "title", title);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => el("all-list").textContent!.includes(title), `the note ${title}`);
  }

  it("keeps items in separate vaults", async () => {
    vaultMenuItem("New vault").click();
    await waitFor(() => visibleScreen() === "screen-vault", "the vault editor");
    setField(el<HTMLFormElement>("form-vault"), "name", "Work");
    el<HTMLFormElement>("form-vault").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => el("vault-menu").textContent === "Work", "the new vault");
    expect(rows("all-list")).toHaveLength(0);

    addItemOfKind("Note");
    await waitFor(() => visibleScreen() === "screen-edit", "the editor");
    const form = el<HTMLFormElement>("form-edit");
    expect(form.querySelector<HTMLSelectElement>('[name="vault"]')!.selectedOptions[0]!.text).toBe(
      "Work",
    );
    setField(form, "title", "Office wifi");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => rows("all-list").length === 1, "the note in Work");
    expect(el("detail").textContent).toContain("Note · Work");

    vaultMenuItem("Personal").click();
    expect(el("all-list").textContent).not.toContain("Office wifi");
  });

  it("moves every item of one vault into another", async () => {
    vaultActions("Work");
    vaultMenuItem("Move all items to").click();
    vaultMenuItem("Personal").click();
    await waitFor(() => el("vault-menu").textContent === "Personal", "the target vault");
    await waitFor(() => el("all-list").textContent!.includes("Office wifi"), "the moved note");
    vaultMenuItem("Work").click();
    expect(rows("all-list")).toHaveLength(0);
  });

  it("moves a deleted vault's items to the trash", async () => {
    await addNote("Badge PIN");
    vaultActions("Work");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vaultMenuItem("Delete vault").click();
    await waitFor(() => el("vault-menu").textContent === "All vaults", "the deleted vault");
    confirm.mockRestore();
    openScope("Trash");
    expect(el("all-list").textContent).toContain("Badge PIN");
    expect(el("all-list").textContent).not.toContain("Office wifi");
  });

  it("moves the only vault's items into a vault created on the way", async () => {
    vaultMenuItem("Personal").click();
    const before = rows("all-list").length + rows("matching-list").length;
    vaultActions("Personal");
    vaultMenuItem("Move all items to").click();
    vaultMenuItem("New vault").click();
    await waitFor(() => visibleScreen() === "screen-vault", "the vault editor");
    setField(el<HTMLFormElement>("form-vault"), "name", "Archive");
    el<HTMLFormElement>("form-vault").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => el("vault-menu").textContent === "Archive", "the new vault");
    await waitFor(
      () => rows("all-list").length + rows("matching-list").length === before,
      "the moved items",
    );
    vaultMenuItem("Personal").click();
    expect(rows("all-list").length + rows("matching-list").length).toBe(0);
  });

  it("forgets the resume copy once the server revokes the session", async () => {
    const { rememberUnlock, resumeUnlock } = await import("../extension/lib/resume.js");
    const vaultKeyRaw = String(sessionArea.get("vaultKeyRaw"));
    server.sessionRevoked = true;
    sessionArea.clear();
    expect(await resumeUnlock()).toBe(false);
    expect(localArea.has("resume")).toBe(false);
    server.sessionRevoked = false;
    const { unlock } = await import("../extension/lib/storage.js");
    await unlock(vaultKeyRaw, "session-token");
    await rememberUnlock(vaultKeyRaw, "session-token");
    expect(localArea.has("resume")).toBe(true);
  });

  it("clears session storage when locked, keeping the offline cache", async () => {
    if (!document.querySelector(".drawer")) el("btn-menu").click();
    [...document.querySelectorAll<HTMLButtonElement>(".drawer-actions .drawer-link")]
      .find((link) => link.textContent === "Lock now")!
      .click();
    await waitFor(() => sessionArea.size === 0, "session storage to be cleared");
    expect(localArea.has("items")).toBe(true);
    expect(localArea.has("resume")).toBe(false);
  });
});
