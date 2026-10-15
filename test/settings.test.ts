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

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ shares: [] }), { status: 200 })),
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

  it("locks the vault from the navigation", async () => {
    await waitFor(() => document.querySelector(".nav-action") !== null, "the lock button");
    document.querySelector<HTMLButtonElement>(".nav-action")!.click();
    await waitFor(() => sessionArea.size === 0, "the session to clear");
    await waitFor(() => document.querySelector(".nav-action") === null, "the lock button to go");
  });
});
