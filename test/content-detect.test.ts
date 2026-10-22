// @vitest-environment happy-dom

import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", {
  storage: { local: { get: async () => ({}) } },
  runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
});

const realRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const shown = this.isConnected && !this.closest("[hidden]");
  return new DOMRect(0, 0, shown ? 200 : 0, shown ? 32 : 0);
};
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

const { isDecoratable, isLoginUsername } = await import("../extension/content/detect.js");
const { isStandalonePhone } = await import("../extension/content/flows/address.js");

function input(html: string, selector = "#target"): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLInputElement>(selector)!;
}

describe("phone fields outside an address form", () => {
  it("decorates a lone phone field so saved numbers can be offered", () => {
    const phone = input('<form><input id="target" type="tel" name="phone"></form>');
    expect(isDecoratable(phone)).toBe(true);
    expect(isStandalonePhone(phone)).toBe(true);
  });

  it("leaves a phone number used to sign in to the login menu", () => {
    const phone = input(
      '<form><input id="target" type="tel" name="phone"><input type="password" name="password"></form>',
    );
    expect(isLoginUsername(phone)).toBe(true);
    expect(isStandalonePhone(phone)).toBe(false);
  });

  it("ignores ordinary text fields", () => {
    const search = input('<form><input id="target" type="text" name="q"></form>');
    expect(isDecoratable(search)).toBe(false);
  });
});
