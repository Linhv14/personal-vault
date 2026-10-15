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

async function waitFor(check: () => boolean, label: string, timeout = 3_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const heading = () => document.querySelector("main h1")?.textContent;

describe("settings page", () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
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
      runtime: { getManifest: () => ({ version: "0.0.0-test" }) },
    });
    sessionArea.set("token", "session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/auth/pin")
          ? new Response(JSON.stringify({ pinKey: raw }), { status: 200 })
          : new Response(JSON.stringify({ shares: [] }), { status: 200 }),
      ),
    );
    const { options } = await import("preact");
    options.debounceRendering = (render) => render();
    await import("../extension/settings/main.js");
  });

  it("opens every section from its address", async () => {
    await waitFor(() => heading() === "Preferences", "the preferences page");
    for (const [hash, title] of [
      ["security", "Security"],
      ["health", "Password health"],
      ["data", "Data"],
      ["account", "Account"],
      ["general", "Preferences"],
    ]) {
      history.replaceState(null, "", `#${hash}`);
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

  it("turns on PIN unlock from Security", async () => {
    history.replaceState(null, "", "#security");
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

  it("locks the vault from the navigation", async () => {
    await waitFor(() => document.querySelector(".nav-action") !== null, "the lock button");
    document.querySelector<HTMLButtonElement>(".nav-action")!.click();
    await waitFor(() => sessionArea.size === 0, "the session to clear");
    await waitFor(() => document.querySelector(".nav-action") === null, "the lock button to go");
  });
});
