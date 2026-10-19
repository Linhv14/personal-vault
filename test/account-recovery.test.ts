import { describe, expect, it } from "vitest";
import { randomBytes } from "../src/core/bytes.js";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  openWithRecovery,
  recoveryAuthKey,
  sealForRecovery,
} from "../src/core/recovery.js";

describe("account recovery codes", () => {
  it("are 160 random bits in groups of four", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(generateRecoveryCode()).not.toBe(code);
  });

  it("accept the code typed in lower case, with spaces or without dashes", () => {
    const code = generateRecoveryCode();
    const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;
    expect(normalizeRecoveryCode(typed)).toBe(code.replace(/-/g, ""));
    expect(normalizeRecoveryCode("C933-BC97-F584")).toBeNull();
    expect(normalizeRecoveryCode(code.replace(/.$/, "1"))).toBeNull();
  });

  it("open the vault key they sealed, and nothing else does", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const material = await sealForRecovery(code, vaultKey);
    expect(await openWithRecovery(code.toLowerCase(), material.wrappedVaultKey)).toEqual(vaultKey);
    await expect(
      openWithRecovery(generateRecoveryCode(), material.wrappedVaultKey),
    ).rejects.toThrow();
  });

  it("send the server an auth key that cannot open the vault key", async () => {
    const code = generateRecoveryCode();
    const material = await sealForRecovery(code, randomBytes(32));
    expect(material.authKey).toBe(await recoveryAuthKey(code));
    expect(material.authKey).not.toContain(code.replace(/-/g, ""));
    expect(await recoveryAuthKey(generateRecoveryCode())).not.toBe(material.authKey);
  });
});
