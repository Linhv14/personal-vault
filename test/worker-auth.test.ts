import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { hashAuthKey } from "../src/core/crypto.js";
import { deviceKind, deviceLabel } from "../src/worker/device-label.js";
import { newSignInEmail } from "../src/worker/emails.js";
import { securityTxt } from "../src/worker/security-headers.js";
import { accountDelayMs, pairDelaySeconds } from "../src/worker/throttle-policy.js";
import {
  numberField,
  objectArrayField,
  objectField,
  readJsonObject,
  stringField,
} from "./helpers.js";
import {
  accountRecord,
  freezeClockAtT0,
  insertAccount,
  REGISTRATION_TOKEN,
  setTime,
  startWorker,
  T0,
  wrongKey,
  type AccountRecord,
  type TestWorker,
} from "./worker-harness.js";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const DAY = 86_400;

async function register(worker: TestWorker, email: string, data: AccountRecord, ua = CHROME_MAC) {
  return worker.fetch("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    json: { email, ...data },
    ua,
  });
}

async function tokenOf(response: Response): Promise<string> {
  return stringField(await readJsonObject(response), "token");
}

async function login(
  worker: TestWorker,
  email: string,
  authKey: string,
  options: { ip?: string; ua?: string; headers?: HeadersInit } = {},
) {
  const response = await worker.fetch("/api/auth/login", {
    method: "POST",
    json: { email, authKey },
    ua: options.ua ?? CHROME_MAC,
    ip: options.ip,
    headers: options.headers,
  });
  return { status: response.status, body: await readJsonObject(response) };
}

freezeClockAtT0();

describe("login throttling", () => {
  it("backs off exponentially per address and network, capped at an hour", () => {
    expect([1, 5, 6, 7, 8].map(pairDelaySeconds)).toEqual([0, 0, 5, 10, 20]);
    expect(pairDelaySeconds(40)).toBe(3600);
  });

  it("only slows the account as a whole, never past a few seconds", () => {
    expect(accountDelayMs(19)).toBe(0);
    expect(accountDelayMs(20)).toBe(250);
    expect(accountDelayMs(25)).toBe(500);
    expect(accountDelayMs(500)).toBe(5000);
  });

  it("blocks the guessing network without locking out the owner elsewhere", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    await register(worker, "owner@example.com", owner);
    const attacker = "198.51.100.7";

    for (let attempt = 1; attempt <= 6; attempt++) {
      const result = await login(worker, "owner@example.com", wrongKey(), { ip: attacker });
      expect(result.status, `attempt ${attempt}`).toBe(401);
    }
    const blocked = await login(worker, "owner@example.com", owner.authKey, { ip: attacker });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "auth.rate_limited", params: { seconds: 5 } });

    const elsewhere = await login(worker, "owner@example.com", owner.authKey, {
      ip: "203.0.113.50",
    });
    expect(elsewhere.status).toBe(200);

    setTime(T0 + 6);
    const later = await login(worker, "owner@example.com", owner.authKey, { ip: attacker });
    expect(later.status).toBe(200);
  });

  it("doubles the wait after each further failure from the same pair", async () => {
    const worker = await startWorker();
    await register(worker, "owner@example.com", accountRecord());
    const attacker = "198.51.100.8";
    let clock = T0;
    const waits: number[] = [];
    while (waits.length < 4) {
      const result = await login(worker, "owner@example.com", wrongKey(), { ip: attacker });
      if (result.status === 429) {
        const seconds = numberField(objectField(result.body, "params"), "seconds");
        waits.push(seconds);
        clock += seconds;
        setTime(clock);
      } else {
        expect(result.status).toBe(401);
      }
    }
    expect(waits).toEqual([5, 10, 20, 40]);
  });

  it("treats unknown addresses exactly like wrong passwords", async () => {
    const worker = await startWorker();
    await register(worker, "owner@example.com", accountRecord());
    const known = await login(worker, "owner@example.com", wrongKey());
    const unknown = await login(worker, "nobody@example.com", wrongKey());
    expect(unknown).toEqual(known);
    for (let attempt = 0; attempt < 6; attempt++) {
      await login(worker, "nobody@example.com", wrongKey());
    }
    expect((await login(worker, "nobody@example.com", wrongKey())).status).toBe(429);
  });

  it("keeps letting the owner in while many networks fail against the account", async () => {
    vi.useRealTimers();
    const worker = await startWorker();
    const owner = accountRecord();
    await register(worker, "owner@example.com", owner);
    for (let i = 0; i < 21; i++) {
      await login(worker, "owner@example.com", wrongKey(), { ip: `10.0.0.${i}` });
    }
    const started = Date.now();
    const result = await login(worker, "owner@example.com", owner.authKey, { ip: "10.0.1.1" });
    expect(result.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });

  it("throttles recovery codes the same way, separately from passwords", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    await register(worker, "owner@example.com", owner);
    const attempt = (ip: string) =>
      worker.fetch("/api/auth/recover/start", {
        method: "POST",
        json: { email: "owner@example.com", recoveryAuthKey: wrongKey() },
        ip,
      });
    for (let i = 0; i < 6; i++) {
      expect((await attempt("198.51.100.9")).status).toBe(401);
    }
    expect((await attempt("198.51.100.9")).status).toBe(429);
    expect((await attempt("203.0.113.60")).status).toBe(401);
    const password = await login(worker, "owner@example.com", owner.authKey, {
      ip: "198.51.100.9",
    });
    expect(password.status).toBe(200);
  });
});

describe("KDF floor", () => {
  it("refuses new accounts and new passwords below 600,000 iterations", async () => {
    const worker = await startWorker();
    const weak = await register(worker, "weak@example.com", accountRecord(599_999));
    expect(weak.status).toBe(400);
    expect(((await weak.json()) as { code: string }).code).toBe("auth.invalid_kdf");

    const owner = accountRecord();
    const token = await tokenOf(await register(worker, "owner@example.com", owner));
    const change = await worker.fetch("/api/auth/change-password", {
      method: "POST",
      token,
      json: { currentAuthKey: owner.authKey, ...accountRecord(300_000) },
    });
    expect(change.status).toBe(400);
  });

  it("lets old accounts sign in and asks the client to upgrade", async () => {
    const worker = await startWorker();
    const old = accountRecord(100_000);
    await insertAccount(worker, "old@example.com", old);
    const result = await login(worker, "old@example.com", old.authKey);
    expect(result.status).toBe(200);
    expect(result.body.upgradeKdf).toBe(true);

    const current = accountRecord();
    await insertAccount(worker, "new@example.com", current);
    const fresh = await login(worker, "new@example.com", current.authKey);
    expect(fresh.body).not.toHaveProperty("upgradeKdf");
  });

  it("upgrades through change-password while keeping the session that asked", async () => {
    const worker = await startWorker();
    const old = accountRecord(100_000);
    await insertAccount(worker, "old@example.com", old);
    const other = await login(worker, "old@example.com", old.authKey, { ua: FIREFOX_WINDOWS });
    const mine = await login(worker, "old@example.com", old.authKey);
    const upgraded = accountRecord();
    const change = await worker.fetch("/api/auth/change-password", {
      method: "POST",
      token: stringField(mine.body, "token"),
      json: { currentAuthKey: old.authKey, ...upgraded, keepSession: true },
    });
    expect(change.status).toBe(200);
    const sessions = (token: string) => worker.fetch("/api/auth/sessions", { token });
    expect((await sessions(stringField(mine.body, "token"))).status).toBe(200);
    expect((await sessions(stringField(other.body, "token"))).status).toBe(401);
    const again = await login(worker, "old@example.com", upgraded.authKey);
    expect(again.body).not.toHaveProperty("upgradeKdf");
  });

  it("still signs every device out on an ordinary password change", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    const token = await tokenOf(await register(worker, "owner@example.com", owner));
    const change = await worker.fetch("/api/auth/change-password", {
      method: "POST",
      token,
      json: { currentAuthKey: owner.authKey, ...accountRecord() },
    });
    expect(change.status).toBe(200);
    expect((await worker.fetch("/api/auth/sessions", { token })).status).toBe(401);
  });
});

describe("account enumeration", () => {
  it("answers a duplicate sign-up like a new one and changes nothing", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    const first = await register(worker, "owner@example.com", owner);
    const intruder = accountRecord();
    const second = await register(worker, "owner@example.com", intruder);
    expect(second.status).toBe(first.status);
    const firstBody = (await first.json()) as Record<string, unknown>;
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(Object.keys(secondBody).sort()).toEqual(Object.keys(firstBody).sort());
    expect(secondBody.accountId).not.toBe(firstBody.accountId);

    const decoy = await worker.fetch("/api/auth/sessions", { token: secondBody.token as string });
    expect(decoy.status).toBe(401);
    expect((await login(worker, "owner@example.com", intruder.authKey)).status).toBe(401);
    expect((await login(worker, "owner@example.com", owner.authKey)).status).toBe(200);
    const count = worker.d1.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("returns plausible KDF params for unknown addresses", async () => {
    const worker = await startWorker();
    await register(worker, "owner@example.com", accountRecord());
    const prelogin = async (email: string) => {
      const response = await worker.fetch("/api/auth/prelogin", {
        method: "POST",
        json: { email },
      });
      return (await response.json()) as { kdf: { iterations: number } };
    };
    const real = await prelogin("owner@example.com");
    const fake = await prelogin("nobody@example.com");
    expect(fake.kdf.iterations).toBe(real.kdf.iterations);
    expect(fake).toEqual(await prelogin("nobody@example.com"));
  });

  it("answers recovery attempts the same for unknown addresses", async () => {
    const worker = await startWorker();
    await register(worker, "owner@example.com", accountRecord());
    const attempt = async (email: string) => {
      const response = await worker.fetch("/api/auth/recover/start", {
        method: "POST",
        json: { email, recoveryAuthKey: wrongKey() },
      });
      const body: unknown = await response.json();
      return { status: response.status, body };
    };
    expect(await attempt("nobody@example.com")).toEqual(await attempt("owner@example.com"));
  });
});

async function signedIn(worker: TestWorker, email: string, ua = CHROME_MAC) {
  const owner = accountRecord();
  await insertAccount(worker, email, owner);
  const { body } = await login(worker, email, owner.authKey, { ua });
  return { owner, token: body.token as string };
}

describe("uniform responses", () => {
  it("answers a share code request without waiting on any lookup, for every address", async () => {
    const worker = await startWorker({ mailer: true });
    const { token } = await signedIn(worker, "owner@example.com");
    const created = await worker.fetch("/api/shares", {
      method: "POST",
      token,
      json: {
        ciphertext: toBase64(randomBytes(64)),
        nonce: toBase64(randomBytes(12)),
        ttlSeconds: 3600,
        maxViews: 1,
        recipients: ["friend@example.com"],
      },
    });
    const share = (await created.json()) as { id: string };
    await worker.settle();
    worker.mail.length = 0;

    const ask = async (email: string) => {
      const mailed = worker.mail.length;
      const release = worker.d1.hold(/share_recipients|share_codes/);
      const response = await worker.fetch(`/api/shares/${share.id}/code`, {
        method: "POST",
        json: { email },
      });
      const seen = {
        status: response.status,
        body: (await response.json()) as unknown,
        background: worker.pending.length,
        mailedBeforeAnswer: worker.mail.length - mailed,
      };
      release();
      await worker.settle();
      return seen;
    };

    const recipient = await ask("friend@example.com");
    const stranger = await ask("stranger@example.com");
    expect(stranger).toEqual(recipient);
    expect(recipient).toEqual({
      status: 200,
      body: { ok: true },
      background: 1,
      mailedBeforeAnswer: 0,
    });
    expect(worker.mail.map((mail) => mail.to)).toEqual(["friend@example.com"]);
  });

  it("answers a sign-up code request without checking whether the address is registered", async () => {
    const worker = await startWorker({ mailer: true });
    await insertAccount(worker, "taken@example.com", accountRecord());

    const ask = async (email: string) => {
      const release = worker.d1.hold(/FROM accounts/);
      const response = await worker.fetch("/api/auth/verify-email", {
        method: "POST",
        json: { email },
      });
      const seen = {
        status: response.status,
        body: (await response.json()) as unknown,
        background: worker.pending.length,
      };
      release();
      await worker.settle();
      return seen;
    };
    const taken = await ask("taken@example.com");
    const fresh = await ask("fresh@example.com");
    expect(fresh).toEqual(taken);
    expect(taken).toEqual({ status: 200, body: { ok: true, required: true }, background: 1 });
    expect(worker.mail.map((mail) => mail.to)).toEqual(["taken@example.com", "fresh@example.com"]);
    expect(worker.mail[0]!.text).not.toMatch(/\b\d{6}\b/);
    expect(worker.mail[1]!.text).toMatch(/\b\d{6}\b/);
  });
});

describe("legacy auth key hashes", () => {
  it("are accepted only by sign-in, which upgrades them", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    const id = await insertAccount(
      worker,
      "legacy@example.com",
      owner,
      await hashAuthKey(owner.authKey),
    );
    const token = "legacy-session-token";
    const tokenHash = toBase64(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    );
    worker.d1.db
      .prepare(
        "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(tokenHash, id, T0, T0 + 30 * DAY);
    const change = await worker.fetch("/api/auth/change-password", {
      method: "POST",
      token,
      json: { currentAuthKey: owner.authKey, ...accountRecord() },
    });
    expect(change.status).toBe(403);

    const result = await login(worker, "legacy@example.com", owner.authKey);
    expect(result.status).toBe(200);
    const stored = worker.d1.db
      .prepare("SELECT auth_key_hash FROM accounts WHERE id = ?")
      .get(id) as { auth_key_hash: string };
    expect(stored.auth_key_hash.startsWith("v2:")).toBe(true);
  });
});

describe("security headers", () => {
  it("pins HTTPS for two years across subdomains on API responses", async () => {
    const worker = await startWorker();
    const response = await worker.fetch("/api/config");
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("serves the share page with the same policy the static headers declare", async () => {
    const block = readFileSync(new URL("../share/_headers", import.meta.url), "utf8").split(
      "\n\n",
    )[0]!;
    const declared = block
      .split("\n")
      .slice(1)
      .map((line) => line.trim().match(/^([^:]+):\s(.*)$/)!)
      .map(([, name, value]) => [name!.toLowerCase(), value!] as const);
    expect(declared.length).toBeGreaterThan(3);

    const worker = await startWorker();
    const response = await worker.fetch("/s/abc");
    for (const [name, value] of declared) {
      expect(response.headers.get(name), name).toBe(value);
    }
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("https://vault.test");
  });

  it("publishes security.txt that expires a year from now", async () => {
    const worker = await startWorker();
    const response = await worker.fetch("/.well-known/security.txt");
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("Contact: mailto:security@7key.online\n");
    expect(text).toContain("Expires: 2027-10-20T12:00:00Z\n");
    expect(text).toContain("Preferred-Languages: en, vi\n");
    expect(text).toContain("Canonical: https://vault.test/.well-known/security.txt\n");
    expect(text).toContain(
      "Policy: https://github.com/Linhv14/personal-vault/blob/main/SECURITY.md\n",
    );
    expect(securityTxt("https://x.test", "me@x.test", 0)).toContain("Contact: mailto:me@x.test");
  });
});

describe("sessions", () => {
  it("labels devices coarsely", () => {
    expect(deviceLabel(CHROME_MAC)).toBe("Chrome · macOS");
    expect(deviceLabel(FIREFOX_WINDOWS)).toBe("Firefox · Windows");
    expect(deviceLabel("node")).toBe("7key CLI");
    expect(deviceLabel("7key-action/1.0")).toBe("GitHub Action");
    expect(deviceLabel(undefined)).toBe("");
    expect(deviceKind("7key CLI")).toBe("cli");
    expect(deviceKind("")).toBe("unknown");
  });

  it("lists, revokes one, and signs out every other device", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    await register(worker, "owner@example.com", owner);
    const cli = await login(worker, "owner@example.com", owner.authKey, { ua: "node" });
    setTime(T0 + 60);
    const firefox = await login(worker, "owner@example.com", owner.authKey, {
      ua: FIREFOX_WINDOWS,
    });
    setTime(T0 + 120);
    const mine = await login(worker, "owner@example.com", owner.authKey);
    const sessions = (token: string) => worker.fetch("/api/auth/sessions", { token });

    const list = await readJsonObject(await sessions(stringField(mine.body, "token")));
    const sessionRows = objectArrayField(list, "sessions");
    expect(sessionRows).toHaveLength(4);
    expect(sessionRows[0]).toMatchObject({ current: true, label: "Chrome · macOS" });
    expect(sessionRows.filter((session) => session.current === true)).toHaveLength(1);
    const cliSession = sessionRows.find((session) => session.kind === "cli");
    if (!cliSession) {
      throw new Error("Expected a CLI session");
    }
    expect(cliSession).toMatchObject({ label: "7key CLI", createdAt: T0 });
    expect(JSON.stringify(list)).not.toContain(stringField(cli.body, "token"));

    const revoke = (id: string) =>
      worker.fetch(`/api/auth/sessions/${id}`, {
        method: "DELETE",
        token: stringField(mine.body, "token"),
      });
    expect((await revoke(stringField(cliSession, "id"))).status).toBe(200);
    expect((await sessions(stringField(cli.body, "token"))).status).toBe(401);
    expect((await revoke(stringField(cliSession, "id"))).status).toBe(404);

    const others = await worker.fetch("/api/auth/sessions/revoke-others", {
      method: "POST",
      token: stringField(mine.body, "token"),
    });
    expect(await others.json()).toEqual({ ok: true, revoked: 2 });
    expect((await sessions(stringField(firefox.body, "token"))).status).toBe(401);
    const remaining = await readJsonObject(await sessions(stringField(mine.body, "token")));
    expect(objectArrayField(remaining, "sessions")).toHaveLength(1);
  });

  it("cannot revoke someone else's session", async () => {
    const worker = await startWorker();
    const tokenA = await tokenOf(await register(worker, "a@example.com", accountRecord()));
    const tokenB = await tokenOf(await register(worker, "b@example.com", accountRecord()));
    const listB = (await (await worker.fetch("/api/auth/sessions", { token: tokenB })).json()) as {
      sessions: { id: string }[];
    };
    const response = await worker.fetch(`/api/auth/sessions/${listB.sessions[0]!.id}`, {
      method: "DELETE",
      token: tokenA,
    });
    expect(response.status).toBe(404);
    expect((await worker.fetch("/api/auth/sessions", { token: tokenB })).status).toBe(200);
  });

  it("expires after 14 idle days, and after 30 days regardless of use", async () => {
    const worker = await startWorker();
    const owner = accountRecord();
    const idle = await tokenOf(await register(worker, "owner@example.com", owner));
    const busy = stringField(
      (await login(worker, "owner@example.com", owner.authKey)).body,
      "token",
    );
    const sessions = (token: string) => worker.fetch("/api/auth/sessions", { token });

    for (const day of [10, 20]) {
      setTime(T0 + day * DAY);
      expect((await sessions(busy)).status).toBe(200);
    }
    expect((await sessions(idle)).status).toBe(401);
    setTime(T0 + 29 * DAY);
    expect((await sessions(busy)).status).toBe(200);
    setTime(T0 + 31 * DAY);
    expect((await sessions(busy)).status).toBe(401);
  });

  it("keeps sessions created before last-seen tracking existed", async () => {
    const worker = await startWorker();
    const token = await tokenOf(await register(worker, "owner@example.com", accountRecord()));
    worker.d1.db.prepare("UPDATE sessions SET last_seen_at = NULL").run();
    setTime(T0 + 20 * DAY);
    expect((await worker.fetch("/api/auth/sessions", { token })).status).toBe(200);
  });

  it("emails the owner when a device signs in for the first time", async () => {
    const worker = await startWorker({ mailer: true });
    const { owner } = await signedIn(worker, "owner@example.com");
    await login(worker, "owner@example.com", owner.authKey);
    await worker.settle();
    expect(worker.mail).toEqual([]);

    await login(worker, "owner@example.com", owner.authKey, {
      ua: FIREFOX_WINDOWS,
      headers: { "Accept-Language": "vi-VN,vi;q=0.9" },
    });
    await worker.settle();
    expect(worker.mail).toHaveLength(1);
    expect(worker.mail[0]!.to).toBe("owner@example.com");
    expect(worker.mail[0]!.subject).toBe("Có lượt đăng nhập mới vào kho 7key");
    expect(worker.mail[0]!.text).toContain("Firefox · Windows");

    await login(worker, "owner@example.com", owner.authKey, { ua: FIREFOX_WINDOWS });
    await worker.settle();
    expect(worker.mail).toHaveLength(1);
  });

  it("stays quiet on the first sign-in of an account that predates device tracking", async () => {
    const worker = await startWorker({ mailer: true });
    const owner = accountRecord();
    await insertAccount(worker, "owner@example.com", owner);
    await login(worker, "owner@example.com", owner.authKey, { ua: FIREFOX_WINDOWS });
    await worker.settle();
    expect(worker.mail).toEqual([]);
  });

  it("names an unrecognized device in the email", () => {
    const email = newSignInEmail(
      { locale: "en", siteUrl: "https://7key.online" },
      { device: "", at: T0 },
    );
    expect(email.text).toContain("an unrecognized device");
    expect(email.text).toContain("20 October 2026");
  });
});
