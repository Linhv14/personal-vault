// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { PAGE_ABORT, PAGE_REQUEST } from "../extension/lib/passkey/protocol.js";

vi.stubGlobal("chrome", {
  storage: { local: { get: async () => ({}) } },
  runtime: {
    sendMessage: vi.fn(async () => ({
      ok: true,
      state: "ready",
      rpId: "example.com",
      passkeys: [],
      excluded: false,
    })),
  },
});

await import("../extension/passkey/bridge.js");

function hosts(): HTMLElement[] {
  return [...document.body.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.style.zIndex !== "",
  );
}

function post(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("passkey prompt", () => {
  it("opens in the top-right corner without covering the page", async () => {
    post({
      type: PAGE_REQUEST,
      id: "one",
      request: {
        kind: "create",
        options: { challenge: "AA", userId: "AA", userName: "me", excludeCredentialIds: [] },
      },
    });
    await settle();
    const [host] = hosts();
    expect(host).toBeDefined();
    expect(host!.style.top).toContain("16px");
    expect(host!.style.right).toContain("16px");
    expect(host!.style.cssText).not.toContain("inset");

    post({ type: PAGE_ABORT, id: "one" });
    await settle();
    expect(hosts()).toHaveLength(0);
  });
});
