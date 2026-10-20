// @vitest-environment happy-dom

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutofillRequest } from "../extension/lib/autofill-protocol.js";
import {
  codeBoxes,
  fillCode,
  findSetupText,
  isOneTimeCodeField,
} from "../extension/content/two-factor.js";

const sent: AutofillRequest[] = [];

vi.stubGlobal("chrome", {
  storage: { local: { get: async () => ({}) } },
  runtime: {
    sendMessage: vi.fn(async (request: AutofillRequest) => {
      sent.push(request);
      switch (request.type) {
        case "autofill:codes":
        case "autofill:suggest":
          return { ok: true, locked: false, suggestions: [], domain: "example.com" };
        case "autofill:totp-found":
          return { ok: true, totp: { domain: "example.com", replace: false } };
        default:
          return { ok: true, prompt: null };
      }
    }),
  },
});

const realRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const shown = this.isConnected && !this.closest("[hidden]");
  return new DOMRect(0, 0, shown ? 200 : 0, shown ? 32 : 0);
};
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

function input(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector("input")!;
}

beforeEach(() => {
  sent.length = 0;
});

describe("one-time code fields", () => {
  it("recognises code fields and leaves ordinary ones alone", () => {
    expect(isOneTimeCodeField(input('<input autocomplete="one-time-code">'))).toBe(true);
    expect(isOneTimeCodeField(input('<input name="otp" maxlength="6">'))).toBe(true);
    expect(
      isOneTimeCodeField(
        input('<label for="c">Authentication code</label><input id="c" inputmode="numeric">'),
      ),
    ).toBe(true);
    expect(isOneTimeCodeField(input('<input name="email" type="email">'))).toBe(false);
    expect(isOneTimeCodeField(input('<input name="search">'))).toBe(false);
    expect(isOneTimeCodeField(input('<input type="password" name="otp">'))).toBe(false);
  });

  it("spreads a code over one box per digit", () => {
    document.body.innerHTML = `<div>${'<input maxlength="1">'.repeat(6)}</div>`;
    const first = document.querySelector("input")!;
    expect(codeBoxes(first)).toHaveLength(6);
    const filled: string[] = [];
    fillCode(first, "123456", (box, value) => {
      box.value = value;
      filled.push(value);
    });
    expect(filled).toEqual(["1", "2", "3", "4", "5", "6"]);
    const single = input('<input name="otp" maxlength="6">');
    fillCode(single, "654321", (box, value) => (box.value = value));
    expect(single.value).toBe("654321");
  });
});

describe("2FA setup pages", () => {
  it("finds an otpauth link or a setup key next to authenticator wording", () => {
    document.body.innerHTML =
      '<a href="otpauth://totp/npm:me?secret=JBSWY3DPEHPK3PXP&issuer=npm">Open in app</a>';
    expect(findSetupText()).toContain("otpauth://totp/npm:me");
    document.body.innerHTML =
      "<p>Scan with your authenticator app or enter this setup key:</p><code>JBSW Y3DP EHPK 3PXP</code>";
    expect(findSetupText()).toBe("JBSWY3DPEHPK3PXP");
  });

  it("ignores codes without setup wording and words that only look like keys", () => {
    document.body.innerHTML = "<p>Order ABCDEFGHABCDEFGH shipped</p>";
    expect(findSetupText()).toBeNull();
    document.body.innerHTML = "<p>Two-factor: ABCDEFGHIJKLMNOPQRST</p>";
    expect(findSetupText()).toBeNull();
  });
});

describe("content script", () => {
  vi.useFakeTimers();

  async function load(): Promise<void> {
    vi.resetModules();
    await import("../extension/content/content.js");
    await vi.advanceTimersByTimeAsync(0);
  }

  it("offers to save a setup key it sees on the page", async () => {
    document.body.innerHTML =
      "<h1>Set up two-factor authentication</h1><p>Setup key: JBSW Y3DP EHPK 3PXP</p>" +
      '<input autocomplete="one-time-code">';
    await load();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toContainEqual({ type: "autofill:totp-found", text: "JBSWY3DPEHPK3PXP" });
  });

  it("offers codes when a code field is focused", async () => {
    document.body.innerHTML = '<input autocomplete="one-time-code" id="code">';
    await load();
    document.querySelector<HTMLInputElement>("#code")!.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((request) => request.type)).toContain("autofill:codes");
  });

  it("offers a strong password as soon as a sign-up password field is focused", async () => {
    document.body.innerHTML = `
      <form><input type="email" name="email"><input type="password" name="pw" id="pw">
      <button type="submit">Create account</button></form>`;
    await load();
    document.querySelector<HTMLInputElement>("#pw")!.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((request) => request.type)).toContain("autofill:suggest");
  });

  it("treats a card's security code as part of the card, not as a 2FA code", async () => {
    document.body.innerHTML = `
      <form><input name="cardnumber" placeholder="Card number">
      <input id="cvc" name="security_code" maxlength="4" inputmode="numeric"></form>`;
    await load();
    document.querySelector<HTMLInputElement>("#cvc")!.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((request) => request.type)).not.toContain("autofill:codes");
  });

  it("does not open the menu on a sign-in form", async () => {
    document.body.innerHTML = `
      <form><input type="email" name="email"><input type="password" name="pw" id="pw" autocomplete="current-password">
      <button type="submit">Sign in</button></form>`;
    await load();
    document.querySelector<HTMLInputElement>("#pw")!.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((request) => request.type)).not.toContain("autofill:suggest");
  });
});
