// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

const serverConfig = vi.fn(async (_url: string) => ({
  registrationOpen: true,
  emailVerification: false,
}));

vi.mock("../extension/lib/api.js", () => ({ serverConfig }));
vi.mock("../extension/lib/storage.js", () => ({
  clearPendingSignup: vi.fn(),
  savePendingSignup: vi.fn(),
  setLocal: vi.fn(),
}));
vi.mock("../extension/popup/auth.js", () => ({ signIn: vi.fn(), finishUnlock: vi.fn() }));
vi.mock("../extension/popup/state.js", () => ({ toast: vi.fn() }));

const { Setup } = await import("../extension/popup/screens/Setup.js");
const { isDefaultServer } = await import("../extension/lib/server.js");

const HOSTED = "https://7key.online";

function serverInput() {
  return document.querySelector<HTMLInputElement>("input[name=apiUrl]")!;
}

afterEach(cleanup);

describe("setup screen", () => {
  it("hides the server on the hosted service, even when another one is remembered", async () => {
    render(h(Setup, { apiUrl: "https://old.example", defaultServer: HOSTED, signup: null }));
    fireEvent.click(await screen.findByText("Sign in to your vault"));
    expect(serverInput().closest("label")!.hidden).toBe(true);
    expect(serverInput().value).toBe(HOSTED);
    await waitFor(() => expect(serverConfig).toHaveBeenCalledWith(HOSTED));
  });

  it("offers the remembered server again behind the own-server link", async () => {
    render(h(Setup, { apiUrl: "https://old.example", defaultServer: HOSTED, signup: null }));
    fireEvent.click(await screen.findByText("Sign in to your vault"));
    fireEvent.click(screen.getByText("Use your own server"));
    await waitFor(() => expect(serverInput().closest("label")!.hidden).toBe(false));
    expect(serverInput().value).toBe("https://old.example");
  });

  it("asks for the server when the build has no hosted service", async () => {
    render(h(Setup, { apiUrl: "", defaultServer: "", signup: null }));
    fireEvent.click(await screen.findByText("Sign in to your vault"));
    expect(serverInput().closest("label")!.hidden).toBe(false);
    expect(screen.getByText("Use your own server").hidden).toBe(true);
  });
});

describe("isDefaultServer", () => {
  it("compares origins and ignores a trailing slash", () => {
    expect(isDefaultServer("https://7key.online/", HOSTED)).toBe(true);
    expect(isDefaultServer("https://old.example", HOSTED)).toBe(false);
    expect(isDefaultServer("not a url", HOSTED)).toBe(false);
    expect(isDefaultServer(undefined, HOSTED)).toBe(false);
    expect(isDefaultServer(HOSTED, "")).toBe(false);
  });
});

describe("creating a vault", () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  async function openCreateForm() {
    render(h(Setup, { apiUrl: "", defaultServer: HOSTED, signup: null }));
    await waitFor(() => expect(serverConfig).toHaveBeenCalled());
    fireEvent.click(document.querySelector<HTMLButtonElement>(".choice")!);
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>("#setup-choice")!.hidden).toBe(true),
    );
  }

  function fill(name: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    fireEvent.input(input, { target: { value } });
    return input;
  }

  it("blocks a master password found in a breach and marks the field", async () => {
    const password = "password1234";
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    fetchMock.mockResolvedValue(new Response(`${hash.slice(5)}:1234`));
    vi.stubGlobal("fetch", fetchMock);
    await openCreateForm();
    fill("email", "me@example.com");
    const input = fill("password", password);
    fill("confirm", password);
    fireEvent.submit(document.querySelector("#form-setup")!);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This password has been exposed in breaches 1,234 times",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
    );
  });

  it("rejects a master password shorter than 12 characters before any network call", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await openCreateForm();
    fill("email", "me@example.com");
    fill("password", "short pass");
    fill("confirm", "short pass");
    fireEvent.submit(document.querySelector("#form-setup")!);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Use at least 12 characters",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
