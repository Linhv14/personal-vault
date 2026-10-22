import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64 } from "../src/core/bytes.js";

const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    },
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        store.set(key, value);
      }
    },
    remove: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  };
}

vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
});

const server = { verifier: null as string | null, pinKey: "", attempts: 0, seen: [] as string[] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as { verifier: string }) : null;
    if (body) {
      server.seen.push(body.verifier);
    }
    if (path === "/api/auth/pin" && init?.method === "PUT") {
      server.verifier = body!.verifier;
      server.pinKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      server.attempts = 0;
      return json({ pinKey: server.pinKey });
    }
    if (path === "/api/auth/pin" && init?.method === "DELETE") {
      server.verifier = null;
      return json({ ok: true });
    }
    if (path === "/api/auth/pin/unlock") {
      if (!server.verifier) {
        return json({ code: "auth.pin_off" }, 410);
      }
      server.attempts += 1;
      if (body!.verifier === server.verifier) {
        server.attempts = 0;
        return json({ pinKey: server.pinKey });
      }
      if (server.attempts >= 5) {
        server.verifier = null;
        return json({ code: "auth.pin_off" }, 410);
      }
      return json({ code: "auth.pin_wrong", params: { count: 5 - server.attempts } }, 403);
    }
    return json({ code: "server.not_found" }, 404);
  }),
);

const { enablePin, disablePin, hasPin, unlockWithPin, PinError } =
  await import("../extension/lib/pin.js");
const { getUnlocked, lock } = await import("../extension/lib/storage.js");

const VAULT_KEY = toBase64(new Uint8Array(32).fill(7));

beforeEach(() => {
  localArea.clear();
  sessionArea.clear();
  Object.assign(server, { verifier: null, pinKey: "", attempts: 0, seen: [] });
  localArea.set("apiUrl", "https://vault.test");
  sessionArea.set("vaultKeyRaw", VAULT_KEY);
  sessionArea.set("token", "session-token");
});

describe("PIN unlock", () => {
  it("reopens the vault after a lock with the right PIN, and never sends or stores it", async () => {
    await enablePin("482913", 1_000);
    expect(await hasPin()).toBe(true);
    await lock();
    expect(await getUnlocked()).toBeNull();

    expect(await unlockWithPin("482913")).toBe(VAULT_KEY);
    expect(await getUnlocked()).toMatchObject({ vaultKeyRaw: VAULT_KEY, token: "session-token" });

    const stored = JSON.stringify([...localArea.values()]);
    for (const leak of ["482913", VAULT_KEY, server.pinKey]) {
      expect(stored).not.toContain(leak);
    }
    expect(server.seen.every((sent) => sent !== "482913")).toBe(true);
  });

  it("reports the tries left and turns itself off when the server wipes the PIN", async () => {
    await enablePin("482913", 1_000);
    await lock();
    await expect(unlockWithPin("000000")).rejects.toMatchObject({ code: "wrong", attemptsLeft: 4 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await unlockWithPin("000000").catch(() => {});
    }
    await expect(unlockWithPin("000000")).rejects.toMatchObject({ code: "off" });
    expect(await hasPin()).toBe(false);
    await expect(unlockWithPin("482913")).rejects.toBeInstanceOf(PinError);
  });

  it("refuses PINs that are not 6 to 12 digits", async () => {
    for (const pin of ["12345", "1234567890123", "12a456"]) {
      await expect(enablePin(pin, 1_000)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(server.verifier).toBeNull();
  });

  it("forgets the PIN locally and on the server when turned off", async () => {
    await enablePin("482913", 1_000);
    await disablePin();
    expect(await hasPin()).toBe(false);
    expect(server.verifier).toBeNull();
  });
});
