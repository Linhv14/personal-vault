// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAccount } from "../src/core/crypto.js";

const EMAIL = "admin@example.com";
const PASSWORD = "correct horse battery staple";
const calls: string[] = [];
let account: Awaited<ReturnType<typeof createAccount>>;
const server = { twoFactor: false, bareLogin: false };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    const { record } = account;
    if (url.pathname === "/api/auth/prelogin") return json({ kdf: record.kdf });
    if (url.pathname === "/api/auth/login") {
      const body = JSON.parse(String(init?.body));
      if (body.authKey !== record.authKey) return json({ code: "auth.invalid_credentials" }, 401);
      if (server.bareLogin) return json({ next: "something new" });
      return server.twoFactor
        ? json({ twoFactor: "required", challenge: "challenge-1", expiresAt: 0 })
        : json({ token: "web-token", wrappedVaultKey: record.wrappedVaultKey });
    }
    if (url.pathname === "/api/auth/login/2fa") {
      const body = JSON.parse(String(init?.body));
      return body.challenge === "challenge-1" && body.code === "246810"
        ? json({ token: "web-token-2fa", wrappedVaultKey: record.wrappedVaultKey })
        : json({ code: "auth.invalid_2fa" }, 401);
    }
    if (url.pathname === "/api/auth/logout") return json({ ok: true });
    return json({ code: "server.not_found" }, 404);
  }),
);

const { IDLE_MINUTES, accountEmail, signIn, signInWithCode, signOut, startWebSession } =
  await import("../web/session.js");
const { getLocal, getUnlocked } = await import("../extension/lib/storage.js");
const { vaultKeySignal } = await import("../extension/ui/store/session.js");

beforeAll(async () => {
  account = await createAccount(EMAIL, PASSWORD, 1_000);
  startWebSession();
});

afterEach(() => {
  vi.useRealTimers();
  calls.length = 0;
  Object.assign(server, { twoFactor: false, bareLogin: false });
});

describe("web dashboard session", () => {
  it("talks only to the page's own origin and keeps nothing in browser storage", async () => {
    await signIn(EMAIL, PASSWORD);
    expect(vaultKeySignal.value).not.toBeNull();
    expect(accountEmail.value).toBe(EMAIL);
    expect(calls.every((call) => call.includes(location.origin))).toBe(true);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect((await getLocal()).apiUrl).toBe(location.origin);
    await signOut();
  });

  it("refuses a wrong master password", async () => {
    await expect(signIn(EMAIL, "wrong")).rejects.toMatchObject({
      messageKey: "error.auth.invalid_credentials",
    });
    expect(vaultKeySignal.value).toBeNull();
  });

  it("locks after the idle limit", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    await signIn(EMAIL, PASSWORD);
    vi.setSystemTime(Date.now() + (IDLE_MINUTES + 1) * 60_000);
    expect(await getUnlocked()).toBeNull();
  });

  it("signs out on the server and forgets the key", async () => {
    await signIn(EMAIL, PASSWORD);
    await signOut();
    expect(calls).toContain(`POST ${location.origin}/api/auth/logout`);
    expect(vaultKeySignal.value).toBeNull();
    expect(await getUnlocked()).toBeNull();
  });

  it("holds the vault shut until the second factor checks out", async () => {
    server.twoFactor = true;
    const pending = await signIn(EMAIL, PASSWORD);
    expect(pending).toMatchObject({ email: EMAIL, challenge: "challenge-1" });
    expect(vaultKeySignal.value).toBeNull();
    expect(await getUnlocked()).toBeNull();

    await expect(signInWithCode(pending!, "135790")).rejects.toMatchObject({
      messageKey: "error.auth.invalid_2fa",
    });
    expect(vaultKeySignal.value).toBeNull();

    await signInWithCode(pending!, "246810");
    expect(vaultKeySignal.value).not.toBeNull();
    expect((await getUnlocked())?.token).toBe("web-token-2fa");
    await signOut();
  });

  it("fails closed on a sign-in answer it does not understand", async () => {
    server.bareLogin = true;
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({
      messageKey: "error.auth.client_outdated",
    });
    expect(vaultKeySignal.value).toBeNull();
  });
});
