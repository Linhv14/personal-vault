import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromBase64Url, toBase64, toBase64Url } from "../src/core/bytes.js";
import {
  createPasskey,
  signAssertion,
  type StoredPasskey,
} from "../extension/lib/passkey/authenticator.js";
import { verifyAssertion } from "../src/worker/webauthn.js";

const RP_ID = "eepgmbamigmadeddhcoldncaolikeagm";
const ORIGIN = `chrome-extension://${RP_ID}`;
const localArea = new Map<string, unknown>();
const sessionArea = new Map<string, unknown>();

function area(store: Map<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      if (keys === null) return Object.fromEntries(store);
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
    },
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) store.set(key, value);
    },
    remove: async (key: string) => void store.delete(key),
    clear: async () => store.clear(),
  };
}

vi.stubGlobal("chrome", {
  storage: { local: area(localArea), session: area(sessionArea) },
  alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
});
vi.stubGlobal("location", { hostname: RP_ID, origin: ORIGIN });
vi.stubGlobal("PublicKeyCredential", {
  isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
});

const device = { passkey: null as StoredPasskey | null, refuse: false };
const buffer = (base64url: string) => fromBase64Url(base64url).buffer;

vi.stubGlobal("navigator", {
  platform: "MacIntel",
  credentials: {
    async create(options: CredentialCreationOptions) {
      if (device.refuse) throw new DOMException("cancelled", "NotAllowedError");
      const created = await createPasskey({
        rpId: RP_ID,
        origin: ORIGIN,
        challenge: toBase64Url(new Uint8Array(options.publicKey!.challenge as ArrayBuffer)),
        userHandle: "dXNlcg",
        userName: options.publicKey!.user.name,
      });
      device.passkey = created.passkey;
      return {
        id: created.registration.credentialId,
        response: {
          getPublicKey: () => buffer(created.registration.publicKey),
          getPublicKeyAlgorithm: () => created.registration.publicKeyAlgorithm,
        },
      };
    },
    async get(options: CredentialRequestOptions) {
      if (device.refuse) throw new DOMException("cancelled", "NotAllowedError");
      const assertion = await signAssertion(device.passkey!, {
        origin: ORIGIN,
        challenge: toBase64Url(new Uint8Array(options.publicKey!.challenge as ArrayBuffer)),
      });
      return {
        id: assertion.credentialId,
        response: {
          clientDataJSON: buffer(assertion.clientDataJSON),
          authenticatorData: buffer(assertion.authenticatorData),
          signature: buffer(assertion.signature),
        },
      };
    },
  },
});

const server = {
  registration: null as null | {
    credentialId: string;
    publicKey: string;
    algorithm: number;
    rpId: string;
    origin: string;
  },
  bioKey: "",
  challenge: "",
  challenges: 0,
};

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
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === "/api/auth/biometric" && init?.method === "PUT") {
      server.registration = body;
      server.bioKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      return json({ bioKey: server.bioKey });
    }
    if (path === "/api/auth/biometric" && init?.method === "DELETE") {
      server.registration = null;
      return json({ ok: true });
    }
    if (path === "/api/auth/biometric/challenge") {
      if (!server.registration) return json({ code: "auth.biometric_off" }, 410);
      server.challenges += 1;
      server.challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      return json({ challenge: server.challenge, credentialId: server.registration.credentialId });
    }
    if (path === "/api/auth/biometric/unlock") {
      const registration = server.registration!;
      const valid = await verifyAssertion({ ...registration, challenge: server.challenge }, body);
      server.challenge = "";
      return valid ? json({ bioKey: server.bioKey }) : json({ code: "auth.biometric_failed" }, 403);
    }
    return json({ code: "server.not_found" }, 404);
  }),
);

const {
  enableBiometric,
  disableBiometric,
  hasBiometric,
  unlockWithBiometric,
  biometricLabel,
  biometricSetupHint,
} = await import("../extension/lib/biometric.js");
const { getUnlocked, lock } = await import("../extension/lib/storage.js");

const VAULT_KEY = toBase64(new Uint8Array(32).fill(9));

beforeEach(() => {
  localArea.clear();
  sessionArea.clear();
  Object.assign(device, { passkey: null, refuse: false });
  Object.assign(server, { registration: null, bioKey: "", challenge: "", challenges: 0 });
  localArea.set("apiUrl", "https://vault.test");
  localArea.set("email", "me@example.com");
  sessionArea.set("vaultKeyRaw", VAULT_KEY);
  sessionArea.set("token", "session-token");
});

describe("biometric unlock", () => {
  it("names the platform's own unlock and where to set it up", () => {
    const cases = [
      ["MacIntel", "bio.touch_id", "bio.setup_mac"],
      ["Win32", "bio.windows_hello", "bio.setup_windows"],
      ["CrOS x86_64", "bio.chromeos", "bio.setup_chromeos"],
      ["Linux x86_64", "bio.screen_lock", "bio.setup_other"],
    ] as const;
    for (const [platform, label, setup] of cases) {
      (navigator as { platform: string }).platform = platform;
      expect([biometricLabel(), biometricSetupHint()]).toEqual([label, setup]);
    }
    (navigator as { platform: string }).platform = "MacIntel";
  });

  it("registers the extension origin and reopens the vault after a lock", async () => {
    await enableBiometric();
    expect(server.registration).toMatchObject({ rpId: RP_ID, origin: ORIGIN, algorithm: -7 });
    expect(await hasBiometric()).toBe(true);
    await lock();

    expect(await unlockWithBiometric()).toBe(VAULT_KEY);
    expect(await getUnlocked()).toMatchObject({ vaultKeyRaw: VAULT_KEY, token: "session-token" });
    const stored = JSON.stringify([...localArea.values()]);
    expect(stored).not.toContain(VAULT_KEY);
    expect(stored).not.toContain(server.bioKey);
  });

  it("shares one prompt between overlapping requests", async () => {
    await enableBiometric();
    await lock();
    const [first, second] = await Promise.all([unlockWithBiometric(), unlockWithBiometric()]);
    expect(first).toBe(VAULT_KEY);
    expect(second).toBe(VAULT_KEY);
    expect(server.challenges).toBe(1);
    expect(await unlockWithBiometric()).toBe(VAULT_KEY);
    expect(server.challenges).toBe(2);
  });

  it("does not open for another authenticator's signature", async () => {
    await enableBiometric();
    await lock();
    const original = device.passkey;
    await createPasskey({
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: "AA",
      userHandle: "dXNlcg",
      userName: "x",
    }).then(({ passkey }) => {
      device.passkey = { ...passkey, credentialId: original!.credentialId };
    });
    await expect(unlockWithBiometric()).rejects.toMatchObject({ code: "failed" });
    expect(await getUnlocked()).toBeNull();
  });

  it("reports a cancelled prompt and keeps the setting", async () => {
    await enableBiometric();
    await lock();
    device.refuse = true;
    await expect(unlockWithBiometric()).rejects.toMatchObject({ code: "cancelled" });
    expect(await hasBiometric()).toBe(true);
  });

  it("forgets the local copy once the server has turned it off", async () => {
    await enableBiometric();
    await lock();
    server.registration = null;
    await expect(unlockWithBiometric()).rejects.toMatchObject({ code: "off" });
    expect(await hasBiometric()).toBe(false);
  });

  it("turns off locally and on the server", async () => {
    await enableBiometric();
    await disableBiometric();
    expect(await hasBiometric()).toBe(false);
    expect(server.registration).toBeNull();
  });
});
