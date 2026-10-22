import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { ApiError } from "../extension/lib/api.js";
import { memoryArea, usePlatform, type StorageArea } from "../extension/lib/platform.js";

const removed: string[] = [];
vi.stubGlobal("chrome", {
  storage: { local: { remove: async (key: string) => void removed.push(key) } },
});

const { forget, openVaultKey, rejection, sealVaultKey, signedInSession } =
  await import("../extension/lib/device-unlock.js");

const serverKey = toBase64(randomBytes(32));
const local = randomBytes(32);
const vaultKeyRaw = toBase64(randomBytes(32));

let session: StorageArea;

beforeEach(() => {
  removed.length = 0;
  session = memoryArea();
  usePlatform({ local: memoryArea(), session, scheduleLock: async () => {} });
});

describe("device unlock sealing", () => {
  it("opens with the same server key, local secret and method", async () => {
    const sealed = await sealVaultKey("pin", serverKey, local, vaultKeyRaw);
    expect(JSON.stringify(sealed)).not.toContain(vaultKeyRaw);
    expect(await openVaultKey("pin", serverKey, local, sealed)).toBe(vaultKeyRaw);
  });

  it("needs both halves of the key", async () => {
    const sealed = await sealVaultKey("pin", serverKey, local, vaultKeyRaw);
    await expect(
      openVaultKey("pin", toBase64(randomBytes(32)), local, sealed),
    ).rejects.toBeDefined();
    await expect(openVaultKey("pin", serverKey, randomBytes(32), sealed)).rejects.toBeDefined();
  });

  it("does not let a PIN seal open as a biometric one", async () => {
    const sealed = await sealVaultKey("pin", serverKey, local, vaultKeyRaw);
    await expect(openVaultKey("biometric", serverKey, local, sealed)).rejects.toBeDefined();
  });

  it("refuses a tampered seal", async () => {
    const sealed = await sealVaultKey("biometric", serverKey, local, vaultKeyRaw);
    const bytes = Uint8Array.from(atob(sealed.ciphertext), (char) => char.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = { ...sealed, ciphertext: toBase64(bytes) };
    await expect(openVaultKey("biometric", serverKey, local, tampered)).rejects.toBeDefined();
  });

  it("uses a fresh nonce every time", async () => {
    const first = await sealVaultKey("pin", serverKey, local, vaultKeyRaw);
    const second = await sealVaultKey("pin", serverKey, local, vaultKeyRaw);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
});

describe("signedInSession", () => {
  it("returns the unlocked key and token", async () => {
    await session.set({ vaultKeyRaw, token: "tok" });
    expect(await signedInSession()).toEqual({ vaultKeyRaw, token: "tok" });
  });

  it("refuses when locked, signed out, or past the lock deadline", async () => {
    await expect(signedInSession()).rejects.toMatchObject({ status: 401 });
    await session.set({ vaultKeyRaw });
    await expect(signedInSession()).rejects.toBeInstanceOf(ApiError);
    await session.set({ vaultKeyRaw, token: "tok", lockAt: Date.now() - 1 });
    await expect(signedInSession()).rejects.toMatchObject({ status: 401 });
  });
});

describe("rejection", () => {
  it("maps gone and denied server answers and nothing else", () => {
    expect(rejection(new ApiError("x", 410))).toBe("gone");
    expect(rejection(new ApiError("x", 401))).toBe("gone");
    expect(rejection(new ApiError("x", 403))).toBe("denied");
    for (const other of [
      new ApiError("x", 500),
      new ApiError("x", 429),
      new ApiError("x", 400),
      new Error("offline"),
      { status: 403 },
      null,
    ]) {
      expect(rejection(other)).toBeNull();
    }
  });
});

describe("forget", () => {
  it("drops only the method's local record", async () => {
    await forget("pin");
    await forget("biometric");
    expect(removed).toEqual(["pin", "biometric"]);
  });
});
