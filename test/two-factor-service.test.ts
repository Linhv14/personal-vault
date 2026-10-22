import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64, utf8Encode } from "../src/core/bytes.js";
import { importVaultKey, openJson, sealJson } from "../src/core/crypto.js";
import { randomKey } from "../src/core/identity.js";
import { generateTotp } from "../src/core/totp.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { handleAutofill } from "../extension/lib/autofill-service.js";

const SENDER = { tabId: 7, url: "https://www.npmjs.com/settings/tfa", domain: "npmjs.com" };
const LOGIN = "55555555-5555-4555-8555-555555555555";
const SECRET = "JBSWY3DPEHPK3PXP";

let puts: { url: string; body: { ciphertext: string; nonce: string } }[] = [];
let key: CryptoKey;

async function setup(item: Record<string, unknown> | null) {
  const raw = randomKey();
  key = await importVaultKey(raw);
  const items = item
    ? [
        {
          id: LOGIN,
          ...(await sealJson(key, item, utf8Encode(`personal-vault/item/${LOGIN}`))),
          updatedAt: 5,
          deletedAt: null,
        },
      ]
    : [];
  usePlatform({
    local: memoryArea({ apiUrl: "http://server.test", unboundItemsMigrated: true, items }),
    session: memoryArea({ vaultKeyRaw: toBase64(raw), token: "t" }),
    scheduleLock: async () => {},
  });
}

const login = (extra: Record<string, unknown> = {}) => ({
  id: LOGIN,
  title: "npm",
  url: "https://www.npmjs.com",
  username: "me",
  password: "pw",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

beforeEach(() => {
  puts = [];
  const store: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (name: string) => ({ [name]: store[name] }),
        set: async (patch: Record<string, unknown>) => Object.assign(store, patch),
        remove: async (name: string) => void delete store[name],
      },
    },
    action: {},
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") {
        puts.push({ url, body: JSON.parse(String(init.body)) });
      }
      return new Response(JSON.stringify({ updatedAt: 10, items: [], serverTime: 10 }));
    }),
  );
});

describe("saving 2FA from a setup page", () => {
  it("adds the secret to the matching login and returns the current code", async () => {
    await setup(login());
    const found = await handleAutofill({ type: "autofill:totp-found", text: SECRET }, SENDER);
    expect(found).toEqual({
      ok: true,
      totp: { domain: "npmjs.com", target: "npm (me)", replace: false },
    });
    const saved = await handleAutofill({ type: "autofill:totp-save" }, SENDER);
    expect(saved).toMatchObject({ ok: true, saved: true });
    expect((saved as { code: string }).code).toMatch(/^\d{6}$/);
    expect(puts).toHaveLength(1);
    const stored = await openJson<{ totp: { secret: string }; password: string }>(
      key,
      puts[0]!.body,
      utf8Encode(`personal-vault/item/${LOGIN}`),
    );
    expect(stored.totp.secret).toBe(SECRET);
    expect(stored.password).toBe("pw");
  });

  it("says it will replace a different secret, and stays quiet for the same one", async () => {
    await setup(
      login({ totp: { secret: "GEZDGNBVGY3TQOJQ", algorithm: "SHA-1", digits: 6, period: 30 } }),
    );
    expect(
      await handleAutofill({ type: "autofill:totp-found", text: SECRET }, SENDER),
    ).toMatchObject({ totp: { replace: true } });
    await setup(login({ totp: { secret: SECRET, algorithm: "SHA-1", digits: 6, period: 30 } }));
    expect(await handleAutofill({ type: "autofill:totp-found", text: SECRET }, SENDER)).toEqual({
      ok: true,
      totp: null,
    });
  });

  it("creates a login when the site has none, and ignores text that is not a secret", async () => {
    await setup(null);
    expect(
      await handleAutofill({ type: "autofill:totp-found", text: "not a key!" }, SENDER),
    ).toEqual({ ok: true, totp: null });
    expect(
      await handleAutofill({ type: "autofill:totp-found", text: SECRET }, SENDER),
    ).toMatchObject({ totp: { domain: "npmjs.com", replace: false } });
    await handleAutofill({ type: "autofill:totp-save" }, SENDER);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).not.toContain(LOGIN);
  });

  it("forgets the offer when another site asks to save it", async () => {
    await setup(login());
    await handleAutofill({ type: "autofill:totp-found", text: SECRET }, SENDER);
    const elsewhere = { ...SENDER, url: "https://evil.test/", domain: "evil.test" };
    expect(await handleAutofill({ type: "autofill:totp-save" }, elsewhere)).toEqual({
      ok: true,
      saved: false,
    });
    expect(puts).toHaveLength(0);
  });
});

describe("filling 2FA codes", () => {
  it("lists logins with a code for the site and fills the current one", async () => {
    const totp = { secret: SECRET, algorithm: "SHA-1" as const, digits: 6, period: 30 };
    await setup(login({ totp }));
    expect(await handleAutofill({ type: "autofill:codes" }, SENDER)).toMatchObject({
      suggestions: [{ id: LOGIN, title: "npm", username: "me" }],
    });
    const reply = await handleAutofill({ type: "autofill:code", id: LOGIN }, SENDER);
    const expected = [
      await generateTotp(totp, Date.now()),
      await generateTotp(totp, Date.now() + 30_000),
    ];
    expect(expected).toContain((reply as { code: string }).code);
    const elsewhere = { ...SENDER, url: "https://evil.test/", domain: "evil.test" };
    expect(await handleAutofill({ type: "autofill:code", id: LOGIN }, elsewhere)).toEqual({
      ok: false,
      error: "no_match",
    });
  });
});

describe("QR images from another origin", () => {
  const reply = (body: BodyInit, type: string) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": type } })),
    );

  it("fetches an https image without cookies and hands it back as data", async () => {
    await setup(null);
    reply(new Uint8Array([137, 80, 78, 71]), "image/png");
    const result = await handleAutofill(
      { type: "autofill:qr-image", url: "https://cdn.example.com/qr.png" },
      SENDER,
    );
    expect(result).toEqual({ ok: true, image: "data:image/png;base64,iVBORw==" });
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ credentials: "omit" });
  });

  it("refuses plain http, other content types and large files", async () => {
    await setup(null);
    reply("<html>", "text/html");
    for (const url of ["http://192.168.1.1/qr.png", "https://cdn.example.com/page"]) {
      expect(await handleAutofill({ type: "autofill:qr-image", url }, SENDER)).toEqual({
        ok: true,
        image: null,
      });
    }
    reply(new Uint8Array(600 * 1024), "image/png");
    expect(
      await handleAutofill(
        { type: "autofill:qr-image", url: "https://cdn.example.com/big.png" },
        SENDER,
      ),
    ).toEqual({ ok: true, image: null });
  });
});
