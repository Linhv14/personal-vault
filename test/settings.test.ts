// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from "vitest";

const localArea = new Map<string, unknown>([
  ["apiUrl", "https://vault.test"],
  ["email", "me@example.com"],
  ["wrappedVaultKey", { ciphertext: "AA", nonce: "AA" }],
  ["items", []],
]);
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        store.set(key, value);
      }
    }),
    clear: vi.fn(async () => store.clear()),
    remove: vi.fn(async (key: string) => void store.delete(key)),
  };
}

async function waitFor(check: () => boolean, label: string, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const heading = () => document.querySelector("main h1")?.textContent;

function routed(input: RequestInfo | URL, init?: RequestInit, raw = ""): Response {
  const path = new URL(String(input)).pathname;
  const body = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
  if (path === "/api/auth/pin") {
    return body({ pinKey: raw });
  }
  if (path === "/api/account/identity") {
    return init?.method === "PUT" ? body({ ok: true }) : body({ identity: null });
  }
  if (path === "/api/orgs") {
    return body({ orgs: [] });
  }
  if (path === "/api/invites") {
    return body({ invites: [] });
  }
  if (path === "/api/config") {
    return body({
      registration: "token",
      emailVerification: false,
      privacyUrl: "https://example.test/privacy",
    });
  }
  return body({ shares: [] });
}

describe("personal settings in the console", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, "", "#/me/general");
    const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    sessionArea.set("vaultKeyRaw", raw);
    vi.stubGlobal("chrome", {
      storage: {
        local: area(localArea),
        session: area(sessionArea),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      permissions: { contains: vi.fn(async () => false) },
      alarms: { create: vi.fn(async () => {}), clear: vi.fn(async () => true) },
      runtime: {
        getManifest: () => ({ version: "0.0.0-test" }),
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
      tabs: { create: vi.fn() },
    });
    sessionArea.set("token", "session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => routed(input, init, raw)),
    );
    const { options } = await import("preact");
    options.debounceRendering = (render) => render();
    await import("../extension/console/main.js");
  });

  it("opens every section from its address", async () => {
    await waitFor(() => heading() === "Preferences", "the preferences page");
    for (const [hash, title] of [
      ["security", "Security"],
      ["health", "Password health"],
      ["data", "Data"],
      ["trash", "Trash"],
      ["account", "Account"],
      ["general", "Preferences"],
    ]) {
      history.replaceState(null, "", `#/me/${hash}`);
      await waitFor(() => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        return heading() === title;
      }, `the ${hash} page`);
    }
  });

  it("stores the website icons choice", async () => {
    const toggle = [...document.querySelectorAll<HTMLLabelElement>("label.row")]
      .find((row) => row.textContent?.includes("Website icons"))!
      .querySelector<HTMLInputElement>("input")!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => localArea.get("showLogos") === false, "the stored choice");
  });

  it("lists the sites that never ask to save and asks again on one once removed", async () => {
    localArea.set("neverAskLogins", ["news.example", "shop.example"]);
    localArea.set("neverAskForms", ["shop.example"]);
    const { reloadLocal } = await import("../extension/settings/state.js");
    await reloadLocal();
    const rows = () => [...document.querySelectorAll<HTMLElement>(".never-save .row")].slice(1);
    await waitFor(() => rows().length === 2, "the two sites");
    expect(rows().map((row) => row.textContent)).toEqual([
      "news.examplePasswords",
      "shop.examplePasswords, cards and addresses",
    ]);
    rows()[1]!.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => rows().length === 1, "the remaining site");
    expect(localArea.get("neverAskLogins")).toEqual(["news.example"]);
    expect(localArea.get("neverAskForms")).toEqual([]);
  });

  it("turns on PIN unlock from Security", async () => {
    history.replaceState(null, "", "#/me/security");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => heading() === "Security", "the security page");
    const setUp = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Set up PIN",
      );
    await waitFor(() => setUp() !== undefined, "the set up button");
    setUp()!.click();
    await waitFor(() => document.getElementById("form-pin") !== null, "the PIN form");
    const form = document.getElementById("form-pin") as HTMLFormElement;
    (form.elements.namedItem("pin") as HTMLInputElement).value = "12345";
    (form.elements.namedItem("confirm") as HTMLInputElement).value = "12345";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(
      () => form.querySelector(".error")?.textContent === "Use 6 to 12 digits.",
      "the length error",
    );
    (form.elements.namedItem("pin") as HTMLInputElement).value = "482913";
    (form.elements.namedItem("confirm") as HTMLInputElement).value = "482913";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => localArea.has("pin"), "the sealed PIN copy", 15_000);
    await waitFor(
      () => document.body.textContent?.includes("PIN is on for this device") ?? false,
      "the PIN state",
    );
  });

  it("links the privacy policy the server publishes from Account", async () => {
    history.replaceState(null, "", "#/me/account");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => heading() === "Account", "the account page");
    const link = () => document.querySelector<HTMLAnchorElement>(".about a");
    await waitFor(() => link() !== null, "the privacy link");
    expect(link()!.getAttribute("href")).toBe("https://example.test/privacy");
    expect(link()!.textContent).toBe("Privacy policy");
  });

  it("lists the personal pages and the organization entry side by side", () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".side-nav a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual([
      "#/me/general",
      "#/me/security",
      "#/me/health",
      "#/me/data",
      "#/me/trash",
      "#/me/account",
      "#/new/projects",
    ]);
  });

  it("locks the vault from the sidebar", async () => {
    const lockButton = () =>
      [...document.querySelectorAll<HTMLButtonElement>(".side-link")].find(
        (button) => button.textContent === "Lock now",
      );
    await waitFor(() => lockButton() !== undefined, "the lock button");
    lockButton()!.click();
    await waitFor(() => sessionArea.size === 0, "the session to clear");
    await waitFor(() => document.querySelector(".locked") !== null, "the locked screen");
  });
});
