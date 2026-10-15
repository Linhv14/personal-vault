// @vitest-environment happy-dom

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutofillRequest, PendingPrompt } from "../extension/lib/autofill-protocol.js";

const PROMPT: PendingPrompt = {
  domain: "example.com",
  username: "me",
  update: false,
  confirmed: false,
};

let pendingOnLoad: PendingPrompt | null = null;
const sent: string[] = [];

vi.stubGlobal("chrome", {
  storage: { local: { get: async () => ({}) } },
  runtime: {
    sendMessage: vi.fn(async (request: AutofillRequest) => {
      sent.push(request.type);
      switch (request.type) {
        case "autofill:pending":
          return { ok: true, prompt: pendingOnLoad };
        case "autofill:capture":
          return { ok: true, prompt: PROMPT };
        case "autofill:confirm":
          return { ok: true, prompt: { ...PROMPT, confirmed: true } };
        default:
          return { ok: true, saved: false };
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

vi.useFakeTimers();

function loginForm(): { form: HTMLFormElement; password: HTMLInputElement } {
  document.body.innerHTML = `
    <form id="login">
      <input type="email" name="email" value="me" />
      <input type="password" name="password" />
      <button type="submit">Sign in</button>
    </form>`;
  const form = document.querySelector<HTMLFormElement>("#login")!;
  const password = form.querySelector<HTMLInputElement>('input[type="password"]')!;
  return { form, password };
}

async function submit(form: HTMLFormElement, password: HTMLInputElement, value: string) {
  password.value = value;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
}

async function load(): Promise<void> {
  vi.resetModules();
  await import("../extension/content/content.js");
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  sent.length = 0;
});

describe("save prompt timing", () => {
  it("asks nothing while the login form is still on screen after a submit", async () => {
    await load();
    const { form, password } = loginForm();
    await submit(form, password, "wrong-password");
    expect(sent).toContain("autofill:capture");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).not.toContain("autofill:confirm");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(sent).toContain("autofill:dismiss");
    expect(sent).not.toContain("autofill:confirm");
  });

  it("drops the capture as soon as the site marks the password invalid", async () => {
    const { form, password } = loginForm();
    await submit(form, password, "wrong-password-2");
    password.setAttribute("aria-invalid", "true");
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toContain("autofill:dismiss");
    expect(sent).not.toContain("autofill:confirm");
  });

  it("asks once the login form is gone for good", async () => {
    const { form, password } = loginForm();
    await submit(form, password, "right-password");
    form.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).not.toContain("autofill:confirm");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toContain("autofill:confirm");
    expect(sent).not.toContain("autofill:dismiss");
  });

  it("does not take a re-rendered login form for a successful sign-in", async () => {
    const { form, password } = loginForm();
    await submit(form, password, "wrong-password-3");
    form.remove();
    await vi.advanceTimersByTimeAsync(500);
    loginForm();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(sent).not.toContain("autofill:confirm");
    expect(sent).toContain("autofill:dismiss");
  });

  it("is not fooled by revealing the password", async () => {
    const { form, password } = loginForm();
    await submit(form, password, "peeked-password");
    password.type = "text";
    await vi.advanceTimersByTimeAsync(11_000);
    expect(sent).not.toContain("autofill:confirm");
  });
});

describe("save prompt after a page load", () => {
  it("drops the capture when the next page is a login form again", async () => {
    pendingOnLoad = PROMPT;
    loginForm();
    await load();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(sent).toContain("autofill:dismiss");
    expect(sent).not.toContain("autofill:confirm");
  });

  it("asks when the next page has no login form", async () => {
    pendingOnLoad = PROMPT;
    document.body.innerHTML = "<main>Welcome back</main>";
    await load();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent).toContain("autofill:confirm");
  });

  it("shows an already confirmed prompt straight away", async () => {
    pendingOnLoad = { ...PROMPT, confirmed: true };
    document.body.innerHTML = "<main>Dashboard</main>";
    await load();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(sent).toEqual(["autofill:pending"]);
  });
});
