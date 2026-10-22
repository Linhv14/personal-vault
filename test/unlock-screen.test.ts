// @vitest-environment happy-dom
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 });

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
const recoverAccount = vi.fn(async () => ({
  code: "NEWC-ODE2-3456-7ABC-DEFG-HIJK-LMNO-PQRS",
  twoFactorDisabled: true,
}));
const requestRecoveryEmail = vi.fn(async () => true);
vi.mock("../extension/lib/account-recovery.js", async (original) => ({
  ...(await original<object>()),
  recoverAccount,
  requestRecoveryEmail,
}));
vi.mock("../extension/lib/resume.js", () => ({ rememberUnlock: vi.fn() }));
class SecondFactorRequired extends Error {
  constructor(readonly pending: unknown) {
    super("Second factor required");
  }
}
const signIn = vi.fn();
const signInWithCode = vi.fn();
vi.mock("../extension/popup/auth.js", () => ({ signIn, signInWithCode, SecondFactorRequired }));
const openSettings = vi.fn();
vi.mock("../extension/popup/state.js", () => ({
  enterVault: vi.fn(),
  toast: vi.fn(),
  openSettings,
}));

const status = { enabled: false, enabledAt: null as number | null, backupCodesLeft: 0 };
const codes = Array.from({ length: 10 }, (_, index) => `abcd${index}-efgh${index}`);
const startTwoFactor = vi.fn(async () => ({
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  uri: "otpauth://totp/7key:me%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=7key",
}));
const enableTwoFactor = vi.fn(async () => {
  Object.assign(status, { enabled: true, enabledAt: 1, backupCodesLeft: 10 });
  return { enabledAt: 1, backupCodes: codes };
});
const disableTwoFactor = vi.fn(async () => {
  Object.assign(status, { enabled: false, enabledAt: null, backupCodesLeft: 0 });
});

vi.mock("../extension/lib/two-factor.js", async (original) => ({
  ...(await original<object>()),
  twoFactorStatus: async () => ({ ...status }),
  startTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  replaceBackupCodes: vi.fn(),
}));
const currentAuthKey = vi.fn(async (password: string) => (password === "right" ? "AUTH" : null));
const showToast = vi.fn();
vi.mock("../extension/settings/state.js", () => ({ currentAuthKey, showToast }));

const { Unlock } = await import("../extension/popup/screens/Unlock.js");
const { ApiError } = await import("../extension/lib/api.js");

beforeEach(() => {
  Object.assign(device, { pin: true, biometric: true });
  unlockWithBiometric.mockClear();
  signIn.mockReset();
  signInWithCode.mockReset();
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
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Unlock" });
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
    expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe("me@example.com");
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
    expect(screen.getByText("Two-factor authentication was turned off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn back on" }));
    expect(openSettings).toHaveBeenCalledWith("security");
    fireEvent.click(screen.getByRole("button", { name: "Saved, open my vault" }));
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("me@example.com", "a brand new password"),
    );
  });

  it("asks for the second factor after the password, with paste and backup codes", async () => {
    device.biometric = false;
    device.pin = false;
    const pending = { email: "me@example.com", challenge: "challenge" };
    signIn.mockRejectedValue(new SecondFactorRequired(pending));
    signInWithCode
      .mockRejectedValueOnce(new ApiError("error.auth.invalid_2fa", 401))
      .mockRejectedValueOnce(new ApiError("error.auth.rate_limited", 429, { seconds: 9 }))
      .mockResolvedValueOnce(undefined);
    render(h(Unlock, { email: "me@example.com" }));
    const password = await screen.findByPlaceholderText("Master password");
    fireEvent.input(password, { target: { value: "correct horse" } });
    fireEvent.submit(document.querySelector("#form-unlock")!);

    const first = await screen.findByLabelText("Digit 1");
    expect(screen.getByText("Two-factor authentication")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(first));
    const verify = screen.getByRole<HTMLButtonElement>("button", { name: "Verify" });
    expect(verify.disabled).toBe(true);

    fireEvent.paste(first, { clipboardData: { getData: () => "123 456" } });
    await waitFor(() => expect(signInWithCode).toHaveBeenCalledWith(pending, "123456"));
    await screen.findByText("That code is not correct");
    expect(screen.getByLabelText<HTMLInputElement>("Digit 1").value).toBe("");

    for (const [index, digit] of [..."654321"].entries()) {
      fireEvent.input(screen.getByLabelText(`Digit ${index + 1}`), { target: { value: digit } });
    }
    await screen.findByText("Try again in 9 seconds");
    expect(screen.getByLabelText<HTMLInputElement>("Digit 1").disabled).toBe(true);
    expect(screen.queryByText("That code is not correct")).toBeNull();
  });

  it("takes a backup code instead of the app code", async () => {
    device.biometric = false;
    device.pin = false;
    const pending = { email: "me@example.com", challenge: "challenge" };
    signIn.mockRejectedValue(new SecondFactorRequired(pending));
    signInWithCode.mockResolvedValue(undefined);
    render(h(Unlock, { email: "me@example.com" }));
    fireEvent.input(await screen.findByPlaceholderText("Master password"), {
      target: { value: "correct horse" },
    });
    fireEvent.submit(document.querySelector("#form-unlock")!);
    fireEvent.click(await screen.findByRole("button", { name: "Use a backup code" }));
    const field = screen.getByLabelText("Enter one of your backup codes");
    fireEvent.input(field, { target: { value: "ab12c-de34f" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(signInWithCode).toHaveBeenCalledWith(pending, "ab12c-de34f"));
  });

  it("goes back to the password when the challenge runs out", async () => {
    device.biometric = false;
    device.pin = false;
    signIn.mockRejectedValue(new SecondFactorRequired({ email: "me@example.com" }));
    signInWithCode.mockRejectedValue(new ApiError("error.auth.two_factor_expired", 401));
    render(h(Unlock, { email: "me@example.com" }));
    fireEvent.input(await screen.findByPlaceholderText("Master password"), {
      target: { value: "correct horse" },
    });
    fireEvent.submit(document.querySelector("#form-unlock")!);
    const first = await screen.findByLabelText("Digit 1");
    fireEvent.input(first, { target: { value: "111111" } });
    await screen.findByText("Sign-in timed out. Enter your master password again.");
    expect(document.querySelector("#form-unlock")).toBeTruthy();
  });
});

const { TwoFactorCard } = await import("../extension/settings/pages/TwoFactorCard.js");

function paste(target: Element, text: string) {
  fireEvent.paste(target, { clipboardData: { getData: () => text } });
}

describe("two-factor settings", () => {
  it("turns on with the master password, a QR code and a code, then shows backup codes", async () => {
    render(h(TwoFactorCard, { unlocked: true }));
    expect((await screen.findByText("Off")).className).toContain("status-chip");
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    const password = screen.getByLabelText("Current master password");
    fireEvent.input(password, { target: { value: "wrong" } });
    fireEvent.submit(document.querySelector("#form-two-factor-password")!);
    await screen.findByText("That is not the current master password");
    expect(startTwoFactor).not.toHaveBeenCalled();

    fireEvent.input(password, { target: { value: "right" } });
    fireEvent.submit(document.querySelector("#form-two-factor-password")!);
    const qr = await screen.findByRole("img", { name: "Scan with your authenticator app" });
    expect(qr.querySelector("path")!.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
    expect(document.querySelector("#two-factor-secret")!.textContent).toBe(
      "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
    );
    expect(screen.queryByRole("button", { name: "Use a backup code" })).toBeNull();

    paste(screen.getByLabelText("Digit 1"), "112233");
    await waitFor(() =>
      expect(enableTwoFactor).toHaveBeenCalledWith("AUTH", "112233", expect.any(String)),
    );
    await screen.findByText("abcd0-efgh0");
    expect(document.querySelectorAll("#backup-codes li")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "I've saved them" }));
    expect((await screen.findByText("On")).className).toContain("on");
    expect(screen.getByText("10 backup codes left")).toBeTruthy();
  });

  it("turns off with the master password and a backup code", async () => {
    Object.assign(status, { enabled: true, enabledAt: 1, backupCodesLeft: 3 });
    render(h(TwoFactorCard, { unlocked: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    fireEvent.input(screen.getByLabelText("Current master password"), {
      target: { value: "right" },
    });
    fireEvent.submit(document.querySelector("#form-two-factor-password")!);
    fireEvent.click(await screen.findByRole("button", { name: "Use a backup code" }));
    fireEvent.input(screen.getByLabelText("Enter one of your backup codes"), {
      target: { value: "abcd1-efgh1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(disableTwoFactor).toHaveBeenCalledWith("AUTH", "abcd1-efgh1", expect.any(String)),
    );
    expect(await screen.findByText("Off")).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith("Two-factor authentication is off");
  });
});
