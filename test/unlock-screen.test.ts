// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const device = { pin: true, biometric: true };
const unlockWithBiometric = vi.fn(() => new Promise<string>(() => {}));

vi.mock("../extension/lib/pin.js", () => ({
  hasPin: async () => device.pin,
  unlockWithPin: vi.fn(),
  PinError: class extends Error {},
  PIN_MIN_LENGTH: 4,
  PIN_MAX_LENGTH: 12,
}));
vi.mock("../extension/lib/biometric.js", () => ({
  hasBiometric: async () => device.biometric,
  unlockWithBiometric,
  biometricLabel: () => "bio.touch_id",
  BiometricError: class extends Error {},
}));
vi.mock("../extension/lib/storage.js", () => ({
  clearAccountData: vi.fn(),
  getUnlocked: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("../extension/lib/resume.js", () => ({ rememberUnlock: vi.fn() }));
vi.mock("../extension/popup/auth.js", () => ({ signIn: vi.fn() }));
vi.mock("../extension/popup/state.js", () => ({ enterVault: vi.fn() }));

const { Unlock } = await import("../extension/popup/screens/Unlock.js");

beforeEach(() => {
  Object.assign(device, { pin: true, biometric: true });
  unlockWithBiometric.mockClear();
});
afterEach(cleanup);

describe("unlock screen", () => {
  it("leads with a single fingerprint button and keeps the PIN usable while it waits", async () => {
    render(h(Unlock, { email: "me@example.com" }));
    const ring = await screen.findByRole("button", {
      name: "Unlock with Touch ID or Mac password",
    });
    await waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledTimes(1));
    expect(ring.textContent).toBe("");
    expect((ring as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ring);
    expect(unlockWithBiometric).toHaveBeenCalledTimes(1);
    expect(screen.getByText("or")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it("keeps the plain layout without biometric unlock", async () => {
    device.biometric = false;
    render(h(Unlock, { email: "me@example.com" }));
    await screen.findByPlaceholderText("PIN");
    expect(document.querySelector("#bio-unlock")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
    expect(unlockWithBiometric).not.toHaveBeenCalled();
  });
});
