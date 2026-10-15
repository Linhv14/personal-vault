// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { PAGE_ABORT, PAGE_REPLY, PAGE_REQUEST } from "../extension/lib/passkey/protocol.js";

const PASSKEY = { credentialId: "AQID", title: "Example", userName: "me@example.com" };
const sendMessage = vi.fn(async (message: { type: string }) =>
  message.type === "passkey:get"
    ? { ok: true, assertion: { credentialId: "AQID" } }
    : { ok: true, state: "ready", rpId: "example.com", passkeys: [PASSKEY], excluded: false },
);
vi.stubGlobal("chrome", {
  storage: { local: { get: async () => ({}) } },
  runtime: { sendMessage },
});

await import("../extension/passkey/bridge.js");
const { conditionalPasskeys } = await import("../extension/lib/passkey/conditional.js");

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

  it("lists passkeys for a conditional sign-in and answers the page when one is used", async () => {
    const replies: unknown[] = [];
    const listen = (event: MessageEvent) => {
      if (event.data?.type === PAGE_REPLY) replies.push(event.data);
    };
    window.addEventListener("message", listen);
    expect(conditionalPasskeys()).toBeNull();
    post({
      type: PAGE_REQUEST,
      id: "cond",
      request: {
        kind: "conditional",
        options: { rpId: "example.com", challenge: "AA", allowCredentialIds: [] },
      },
    });
    await settle();
    expect(hosts()).toHaveLength(0);
    expect(await conditionalPasskeys()!.list()).toEqual({ locked: false, passkeys: [PASSKEY] });
    expect(await conditionalPasskeys()!.use("AQID")).toBe(true);
    await settle();
    expect(replies).toMatchObject([
      { id: "cond", reply: { kind: "assertion", assertion: { credentialId: "AQID" } } },
    ]);
    expect(conditionalPasskeys()).toBeNull();
    window.removeEventListener("message", listen);
  });

  it("forgets a conditional sign-in the page aborted", async () => {
    post({
      type: PAGE_REQUEST,
      id: "gone",
      request: { kind: "conditional", options: { challenge: "AA", allowCredentialIds: [] } },
    });
    await settle();
    expect(conditionalPasskeys()).not.toBeNull();
    post({ type: PAGE_ABORT, id: "gone" });
    expect(conditionalPasskeys()).toBeNull();
  });
});
