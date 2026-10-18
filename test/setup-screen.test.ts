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
    expect(isDefaultServer("https://1pw.online", HOSTED)).toBe(false);
    expect(isDefaultServer("not a url", HOSTED)).toBe(false);
    expect(isDefaultServer(undefined, HOSTED)).toBe(false);
    expect(isDefaultServer(HOSTED, "")).toBe(false);
  });
});
