import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/core/bytes.js";
import { createAccount, rewrapVaultKey, unlockVault } from "../src/core/crypto.js";
import {
  generateRecoveryCode,
  openWithRecovery,
  recoveryAuthKey,
  sealForRecovery,
} from "../src/core/recovery.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
const ITERATIONS = 100_000;
const enabled = process.env.VAULT_E2E === "1";

async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe.skipIf(!enabled)("account recovery against Worker + D1", () => {
  const stranger = { record: { authKey: toBase64(new Uint8Array(32).fill(7)) } };

  it("resets a forgotten master password with the recovery code, once", async () => {
    const owner = `recover-${Date.now()}@example.com`;
    const created = await createAccount(owner, "the password I will forget", ITERATIONS);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email: owner, ...created.record }),
    });
    const ownerToken = registered.body.token;
    const unlocked = await unlockVault(owner, "the password I will forget", created.record);
    const code = generateRecoveryCode();
    const material = await sealForRecovery(code, unlocked.vaultKeyRaw);

    expect((await api("/api/account/recovery", { token: ownerToken })).body.createdAt).toBeNull();
    const unproven = await api("/api/account/recovery", {
      method: "PUT",
      token: ownerToken,
      body: JSON.stringify({ currentAuthKey: stranger.record.authKey, ...material }),
    });
    expect(unproven.status).toBe(403);
    const saved = await api("/api/account/recovery", {
      method: "PUT",
      token: ownerToken,
      body: JSON.stringify({ currentAuthKey: created.record.authKey, ...material }),
    });
    expect(saved.status).toBe(200);
    expect((await api("/api/account/recovery", { token: ownerToken })).body.createdAt).toBe(
      saved.body.createdAt,
    );

    const start = (recoveryKey: string) =>
      api("/api/auth/recover/start", {
        method: "POST",
        body: JSON.stringify({ email: owner, recoveryAuthKey: recoveryKey }),
      });
    const wrong = await start(await recoveryAuthKey(generateRecoveryCode()));
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("auth.invalid_recovery_code");
    const unknown = await api("/api/auth/recover/start", {
      method: "POST",
      body: JSON.stringify({
        email: `nobody-${Date.now()}@example.com`,
        recoveryAuthKey: material.authKey,
      }),
    });
    expect(unknown.status).toBe(401);

    const started = await start(material.authKey);
    expect(started.status).toBe(200);
    const vaultKeyRaw = await openWithRecovery(code, started.body.wrappedVaultKey);
    expect(toBase64(vaultKeyRaw)).toBe(toBase64(unlocked.vaultKeyRaw));

    const nextCode = generateRecoveryCode();
    const next = await rewrapVaultKey(
      owner,
      "a brand new master password",
      vaultKeyRaw,
      ITERATIONS,
    );
    const finished = await api("/api/auth/recover/finish", {
      method: "POST",
      body: JSON.stringify({
        email: owner,
        recoveryAuthKey: material.authKey,
        ...next,
        recovery: await sealForRecovery(nextCode, vaultKeyRaw),
      }),
    });
    expect(finished.status).toBe(200);

    expect((await api("/api/items", { token: ownerToken })).status).toBe(401);
    expect((await start(material.authKey)).status).toBe(401);
    expect((await start(await recoveryAuthKey(nextCode))).status).toBe(200);
    const oldLogin = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: owner, authKey: created.record.authKey }),
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: owner, authKey: next.authKey }),
    });
    expect(newLogin.status).toBe(200);
    const reopened = await unlockVault(owner, "a brand new master password", {
      kdf: next.kdf,
      wrappedVaultKey: newLogin.body.wrappedVaultKey,
    });
    expect(toBase64(reopened.vaultKeyRaw)).toBe(toBase64(vaultKeyRaw));

    const removed = await api("/api/account/recovery", {
      method: "DELETE",
      token: newLogin.body.token,
      body: JSON.stringify({ currentAuthKey: next.authKey }),
    });
    expect(removed.status).toBe(200);
    expect((await start(await recoveryAuthKey(nextCode))).status).toBe(401);
  });
});
