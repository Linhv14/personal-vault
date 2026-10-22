// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { frameTurnstileToken, turnstileFrameUrl } from "../extension/lib/turnstile-frame.js";
import { turnstileSlot } from "../src/ui/turnstile.js";

const API = "https://7key.online";

function frameIn(slot: HTMLElement): HTMLIFrameElement {
  const frame = slot.querySelector("iframe");
  if (!frame) {
    throw new Error("no frame");
  }
  return frame;
}

function post(frame: HTMLIFrameElement, data: unknown, origin = API) {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin, source: frame.contentWindow as Window }),
  );
}

beforeAll(() => {
  const happy = (
    window as unknown as {
      happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } };
    }
  ).happyDOM;
  happy.settings.navigation.disableChildFrameNavigation = true;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("turnstileSlot", () => {
  it("picks the slot of the visible form", () => {
    document.body.innerHTML = `
      <form hidden><div data-turnstile id="a"></div></form>
      <form><div data-turnstile id="b"></div></form>`;
    expect(turnstileSlot().id).toBe("b");
  });

  it("falls back to a slot on the body", () => {
    const slot = turnstileSlot();
    expect(slot.parentElement).toBe(document.body);
    expect(slot.hasAttribute("data-turnstile")).toBe(true);
  });
});

describe("frameTurnstileToken", () => {
  it("points the frame at the server's Turnstile page with the extension origin", () => {
    expect(turnstileFrameUrl(`${API}/`, "chrome-extension://abc")).toBe(
      `${API}/turnstile?origin=chrome-extension%3A%2F%2Fabc`,
    );
  });

  it("resolves with the token the frame posts and removes the frame", async () => {
    const slot = turnstileSlot();
    const pending = frameTurnstileToken(API, slot);
    const frame = frameIn(slot);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-popups");
    post(frame, { source: "7key-turnstile", token: "abc" });
    await expect(pending).resolves.toBe("abc");
    expect(slot.querySelector("iframe")).toBeNull();
  });

  it("ignores messages from other origins and shows the frame when interaction is needed", async () => {
    const slot = turnstileSlot();
    const pending = frameTurnstileToken(API, slot);
    const frame = frameIn(slot);
    post(frame, { source: "7key-turnstile", token: "forged" }, "https://evil.example");
    post(frame, { source: "7key-turnstile", interactive: true });
    expect(frame.classList.contains("interactive")).toBe(true);
    post(frame, { source: "7key-turnstile", token: "real" });
    await expect(pending).resolves.toBe("real");
  });

  it("rejects when the widget reports an error", async () => {
    const slot = turnstileSlot();
    const pending = frameTurnstileToken(API, slot);
    post(frameIn(slot), { source: "7key-turnstile", error: true });
    await expect(pending).rejects.toThrow("turnstile_failed");
  });

  it("gives up when the frame stays silent", async () => {
    vi.useFakeTimers();
    const slot = turnstileSlot();
    const pending = frameTurnstileToken(API, slot);
    const assertion = expect(pending).rejects.toThrow("turnstile_failed");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(slot.querySelector("iframe")).toBeNull();
  });
});

describe("humanCheckHeaders", () => {
  it("adds no header when the server has no site key", async () => {
    const api = await import("../extension/lib/api.js");
    const check = vi.fn(async () => "token");
    api.setHumanCheck(check);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ registration: "token", emailVerification: false })),
    );
    await expect(api.humanCheckHeaders(API)).resolves.toEqual({});
    expect(check).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    api.setHumanCheck(null);
  });

  it("asks the provider for a token when the server publishes a site key", async () => {
    const api = await import("../extension/lib/api.js");
    api.setHumanCheck(async (_url, siteKey) => `token-for-${siteKey}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ registration: "token", turnstileSiteKey: "site" })),
    );
    await expect(api.humanCheckHeaders(API)).resolves.toEqual({
      "X-Turnstile-Token": "token-for-site",
    });
    api.setHumanCheck(async () => {
      throw new Error("nope");
    });
    await expect(api.humanCheckHeaders(API)).rejects.toMatchObject({
      messageKey: "error.auth.bot_check_failed",
    });
    vi.unstubAllGlobals();
    api.setHumanCheck(null);
  });
});
