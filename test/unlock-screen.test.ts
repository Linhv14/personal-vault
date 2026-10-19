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
  getLocal: async () => ({ apiUrl: "https://7key.online", email: "me@example.com" }),
  setLocal: vi.fn(),
  lock: vi.fn(),
}));
const recoverAccount = vi.fn(async () => "NEWC-ODE2-3456-7ABC-DEFG-HIJK-LMNO-PQRS");
const requestRecoveryEmail = vi.fn(async () => true);
vi.mock("../extension/lib/account-recovery.js", async (original) => ({
  ...(await original<object>()),
  recoverAccount,
  requestRecoveryEmail,
}));
vi.mock("../extension/lib/resume.js", () => ({ rememberUnlock: vi.fn() }));
const signIn = vi.fn();
vi.mock("../extension/popup/auth.js", () => ({ signIn }));
vi.mock("../extension/popup/state.js", () => ({ enterVault: vi.fn(), toast: vi.fn() }));

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

  it("resets a forgotten master password with the recovery code and an emailed code", async () => {
    device.biometric = false;
    device.pin = false;
    render(h(Unlock, { email: "me@example.com" }));
    fireEvent.click(await screen.findByRole("button", { name: "Forgot master password?" }));
    const code = await screen.findByLabelText("Recovery code");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("me@example.com");
    fireEvent.input(code, { target: { value: "C933-BC97-F584" } });
    fireEvent.submit(document.querySelector("#form-recover")!);
    await screen.findByText(/not a recovery code/);
    expect(requestRecoveryEmail).not.toHaveBeenCalled();

    const valid = "abcd efgh ijkl mnop qrst uvwx yz23 4567";
    fireEvent.input(code, { target: { value: valid } });
    fireEvent.submit(document.querySelector("#form-recover")!);
    const emailCode = await screen.findByLabelText("Code from the email");
    expect(requestRecoveryEmail).toHaveBeenCalledWith("me@example.com", valid, expect.any(String));
    fireEvent.input(emailCode, { target: { value: "123456" } });
    fireEvent.input(screen.getByLabelText("New master password"), {
      target: { value: "a brand new password" },
    });
    fireEvent.input(screen.getByLabelText("Confirm master password"), {
      target: { value: "a brand new password" },
    });
    fireEvent.submit(document.querySelector("#form-recover-password")!);
    await screen.findByText("NEWC-ODE2-3456-7ABC-DEFG-HIJK-LMNO-PQRS");
    expect(recoverAccount).toHaveBeenCalledWith(
      "me@example.com",
      valid,
      "a brand new password",
      expect.any(String),
      "123456",
    );
    fireEvent.click(screen.getByRole("button", { name: "Saved, open my vault" }));
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("me@example.com", "a brand new password"),
    );
  });
});
