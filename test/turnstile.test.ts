import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { REGISTRATION_TOKEN, startWorker } from "./worker-harness.js";

const SITE_KEY = "1x00000000000000000000AA";
const SECRET = "0x4AAAAAAAtestsecretvalue000000000";
const PASSING_DUMMY_SECRET = "1x0000000000000000000000000000000AA";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const GOOD_TOKEN = "good-token";

const enabled = { TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET: SECRET };

interface Verification {
  secret: string;
  response: string;
  remoteip: string | null;
}

function stubSiteverify(
  answer: (form: Verification) => Response | Promise<Response> = (form) =>
    Response.json(
      form.response === GOOD_TOKEN
        ? { success: true, hostname: "vault.test" }
        : { success: false, "error-codes": ["invalid-input-response"] },
    ),
) {
  const calls: Verification[] = [];
  const original = globalThis.fetch;
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== SITEVERIFY) return original(input, init);
    const form = init?.body as FormData;
    const call = {
      secret: String(form.get("secret")),
      response: String(form.get("response")),
      remoteip: form.get("remoteip") as string | null,
    };
    calls.push(call);
    return answer(call);
  });
  vi.stubGlobal("fetch", stub);
  return calls;
}

function account() {
  return {
    email: "turnstile@example.com",
    kdf: { type: "pbkdf2-sha256", iterations: 600_000, salt: toBase64(randomBytes(16)) },
    authKey: toBase64(randomBytes(32)),
    wrappedVaultKey: { ciphertext: toBase64(randomBytes(48)), nonce: toBase64(randomBytes(12)) },
  };
}

const recovery = { email: "turnstile@example.com", recoveryAuthKey: toBase64(randomBytes(32)) };

const PROTECTED: [string, unknown][] = [
  ["/api/auth/register", account()],
  ["/api/auth/verify-email", { email: "turnstile@example.com" }],
  ["/api/auth/recover/email", recovery],
  ["/api/auth/recover/start", recovery],
  ["/api/shares/abc123/code", { email: "turnstile@example.com" }],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Turnstile disabled", () => {
  it("leaves every endpoint as it was and hides the site key", async () => {
    const calls = stubSiteverify();
    const worker = await startWorker({ vars: { TURNSTILE_SITE_KEY: SITE_KEY } });
    const config = (await (await worker.fetch("/api/config")).json()) as Record<string, unknown>;
    expect(config).not.toHaveProperty("turnstileSiteKey");

    const response = await worker.fetch("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      json: account(),
    });
    expect(response.status).toBe(201);
    expect(await (await worker.fetch("/turnstile")).text()).not.toContain("turnstile/v0/api.js");
    expect(calls).toHaveLength(0);
  });
});

describe("Turnstile enabled", () => {
  it("publishes the site key in /api/config", async () => {
    stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const config = (await (await worker.fetch("/api/config")).json()) as Record<string, unknown>;
    expect(config.turnstileSiteKey).toBe(SITE_KEY);
  });

  it.each(PROTECTED)("rejects %s without a token", async (path, body) => {
    const calls = stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch(path, { method: "POST", json: body });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("auth.bot_check_failed");
    expect(calls).toHaveLength(0);
  });

  it.each(PROTECTED)("rejects %s with a token siteverify refuses", async (path, body) => {
    const calls = stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch(path, {
      method: "POST",
      json: body,
      headers: { "X-Turnstile-Token": "forged" },
    });
    expect(response.status).toBe(403);
    expect(calls).toEqual([{ secret: SECRET, response: "forged", remoteip: "203.0.113.1" }]);
  });

  it.each(PROTECTED)("lets %s through with a valid token", async (path, body) => {
    stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch(path, {
      method: "POST",
      json: body,
      headers: { "X-Turnstile-Token": GOOD_TOKEN, "x-registration-token": REGISTRATION_TOKEN },
    });
    expect(response.status).not.toBe(403);
  });

  it("creates an account once the check passes", async () => {
    stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/api/auth/register", {
      method: "POST",
      json: account(),
      headers: { "X-Turnstile-Token": GOOD_TOKEN, "x-registration-token": REGISTRATION_TOKEN },
    });
    expect(response.status).toBe(201);
  });

  it("rejects a token minted for another hostname", async () => {
    stubSiteverify(() => Response.json({ success: true, hostname: "evil.example" }));
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/api/shares/abc123/code", {
      method: "POST",
      json: { email: "turnstile@example.com" },
      headers: { "X-Turnstile-Token": GOOD_TOKEN },
    });
    expect(response.status).toBe(403);
  });

  it("accepts a token minted on an alias origin", async () => {
    stubSiteverify(() => Response.json({ success: true, hostname: "alias.example" }));
    const worker = await startWorker({
      vars: { ...enabled, ALIAS_ORIGINS: "https://alias.example" },
    });
    const response = await worker.fetch("/api/shares/abc123/code", {
      method: "POST",
      json: { email: "turnstile@example.com" },
      headers: { "X-Turnstile-Token": GOOD_TOKEN },
    });
    expect(response.status).toBe(200);
  });

  it("skips the hostname check for Cloudflare's dummy secrets", async () => {
    stubSiteverify(() => Response.json({ success: true, hostname: "example.com" }));
    const worker = await startWorker({
      vars: { TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET: PASSING_DUMMY_SECRET },
    });
    const response = await worker.fetch("/api/shares/abc123/code", {
      method: "POST",
      json: { email: "turnstile@example.com" },
      headers: { "X-Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    });
    expect(response.status).toBe(200);
  });

  it("fails closed when siteverify cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSiteverify(() => {
      throw new TypeError("network down");
    });
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/api/shares/abc123/code", {
      method: "POST",
      json: { email: "turnstile@example.com" },
      headers: { "X-Turnstile-Token": GOOD_TOKEN },
    });
    expect(response.status).toBe(403);
    expect(console.error).toHaveBeenCalled();
  });

  it("fails closed when siteverify answers with an error status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSiteverify(() => new Response("bad gateway", { status: 502 }));
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/api/shares/abc123/code", {
      method: "POST",
      json: { email: "turnstile@example.com" },
      headers: { "X-Turnstile-Token": GOOD_TOKEN },
    });
    expect(response.status).toBe(403);
  });

  it("leaves sign-in, share reads and opening with a code unprotected", async () => {
    const calls = stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const prelogin = await worker.fetch("/api/auth/prelogin", {
      method: "POST",
      json: { email: "turnstile@example.com" },
    });
    expect(prelogin.status).toBe(200);
    const login = await worker.fetch("/api/auth/login", {
      method: "POST",
      json: { email: "turnstile@example.com", authKey: toBase64(randomBytes(32)) },
    });
    expect(login.status).toBe(401);
    expect((await worker.fetch("/api/shares/abc123")).status).toBe(404);
    const open = await worker.fetch("/api/shares/abc123/open", {
      method: "POST",
      json: { email: "turnstile@example.com", code: "123456" },
    });
    expect(open.status).not.toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("allows the token header in CORS preflights from the extension", async () => {
    stubSiteverify();
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/api/auth/register", {
      method: "OPTIONS",
      headers: {
        Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-turnstile-token",
      },
    });
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "x-turnstile-token",
    );
  });
});

describe("Turnstile frame page", () => {
  it("renders the widget for extension pages only and posts back to the named origin", async () => {
    const worker = await startWorker({ vars: enabled });
    const response = await worker.fetch("/turnstile?origin=chrome-extension%3A%2F%2Fabc");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([0-9a-f]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'self' chrome-extension: moz-extension:");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(response.headers.get("x-frame-options")).toBeNull();
    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`sitekey: "${SITE_KEY}"`);
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("does not exist while Turnstile is off", async () => {
    const worker = await startWorker();
    const response = await worker.fetch("/turnstile");
    expect(await response.text()).not.toContain("turnstile/v0/api.js");
  });
});
