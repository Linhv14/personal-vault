import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSecondFactor } from "../src/core/account-two-factor.js";
import { randomBytes, toBase64 } from "../src/core/bytes.js";
import { generateTotp, parseOtpauthUri } from "../src/core/totp.js";
import { protectAuthKey, protectWrappedKey } from "../src/worker/at-rest.js";
import { numberField, readJsonObject, stringArrayField, stringField } from "./helpers.js";
import { startWorker, type TestWorker } from "./worker-harness.js";

const T0 = Date.UTC(2026, 9, 20, 12) / 1000;
const EMAIL = "owner@example.com";

function record() {
  return {
    kdf: { type: "pbkdf2-sha256", iterations: 600_000, salt: toBase64(randomBytes(16)) },
    authKey: toBase64(randomBytes(32)),
    wrappedVaultKey: { ciphertext: toBase64(randomBytes(48)), nonce: toBase64(randomBytes(12)) },
  };
}

type Account = ReturnType<typeof record> & { token: string };

const wrongKey = () => toBase64(randomBytes(32));

function setTime(seconds: number) {
  vi.setSystemTime(seconds * 1000);
}

async function json(response: Response) {
  return { status: response.status, body: await readJsonObject(response) };
}

async function register(worker: TestWorker, email = EMAIL): Promise<Account> {
  const data = record();
  const id = crypto.randomUUID();
  worker.d1.db
    .prepare(
      `INSERT INTO accounts (id, email, kdf_type, kdf_iterations, kdf_salt, auth_key_hash,
         wrapped_vault_key, wrap_nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      email,
      data.kdf.type,
      data.kdf.iterations,
      data.kdf.salt,
      await protectAuthKey(worker.env, data.authKey),
      await protectWrappedKey(worker.env, id, data.wrappedVaultKey.ciphertext),
      data.wrappedVaultKey.nonce,
      T0,
    );
  const { body } = await login(worker, data.authKey, { email });
  return { ...data, token: stringField(body, "token") };
}

function login(worker: TestWorker, authKey: string, options: { ip?: string; email?: string } = {}) {
  return worker
    .fetch("/api/auth/login", {
      method: "POST",
      json: { email: options.email ?? EMAIL, authKey },
      ip: options.ip,
    })
    .then(json);
}

function secondStep(worker: TestWorker, challenge: string, code: string, ip?: string) {
  return worker
    .fetch("/api/auth/login/2fa", { method: "POST", json: { challenge, code }, ip })
    .then(json);
}

function post(worker: TestWorker, path: string, token: string, body: unknown) {
  return worker.fetch(path, { method: "POST", token, json: body }).then(json);
}

async function codeAt(secret: string, seconds: number) {
  return generateTotp({ secret }, seconds * 1000);
}

async function enable(worker: TestWorker, account: Account) {
  const setup = await post(worker, "/api/account/2fa/setup", account.token, {
    currentAuthKey: account.authKey,
  });
  const secret = stringField(setup.body, "secret");
  const enabled = await post(worker, "/api/account/2fa/enable", account.token, {
    currentAuthKey: account.authKey,
    code: await codeAt(secret, T0),
  });
  return { secret, backupCodes: stringArrayField(enabled.body, "backupCodes"), enabled };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enrollment", () => {
  it("asks for the master password, then a working code, before turning on", async () => {
    const worker = await startWorker({ mailer: true });
    const account = await register(worker);
    const other = await login(worker, account.authKey);

    const refused = await post(worker, "/api/account/2fa/setup", account.token, {
      currentAuthKey: wrongKey(),
    });
    expect(refused.status).toBe(403);

    const setup = await post(worker, "/api/account/2fa/setup", account.token, {
      currentAuthKey: account.authKey,
    });
    expect(setup.status).toBe(200);
    const config = parseOtpauthUri(stringField(setup.body, "uri"));
    expect(config).toMatchObject({
      secret: stringField(setup.body, "secret"),
      issuer: "7key",
      account: EMAIL,
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });

    const wrong = await post(worker, "/api/account/2fa/enable", account.token, {
      currentAuthKey: account.authKey,
      code: "000000",
    });
    expect(wrong).toMatchObject({ status: 400, body: { code: "auth.invalid_2fa" } });
    expect(
      (await json(await worker.fetch("/api/account/2fa", { token: account.token }))).body,
    ).toMatchObject({ enabled: false });

    const enabled = await post(worker, "/api/account/2fa/enable", account.token, {
      currentAuthKey: account.authKey,
      code: await codeAt(stringField(setup.body, "secret"), T0 + 25),
    });
    expect(enabled.status).toBe(200);
    expect(stringArrayField(enabled.body, "backupCodes")).toHaveLength(10);
    const backupCodes = stringArrayField(enabled.body, "backupCodes");
    expect(new Set(backupCodes).size).toBe(10);
    for (const code of backupCodes) {
      expect(code).toMatch(/^[0-9a-z]{5}-[0-9a-z]{5}$/);
    }

    const status = await json(await worker.fetch("/api/account/2fa", { token: account.token }));
    expect(status.body).toEqual({ enabled: true, enabledAt: T0, backupCodesLeft: 10 });

    const stale = await worker.fetch("/api/account/2fa", {
      token: stringField(other.body, "token"),
    });
    expect(stale.status).toBe(401);
    await worker.settle();
    expect(worker.mail.map((mail) => mail.subject)).toContain(
      "Two-factor authentication is on for your 7key vault",
    );
  });

  it("keeps the secret encrypted and the backup codes hashed at rest", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret, backupCodes } = await enable(worker, account);
    const row = worker.d1.db
      .prepare("SELECT totp_secret, totp_pending_secret FROM accounts WHERE email = ?")
      .get(EMAIL) as { totp_secret: string; totp_pending_secret: string | null };
    expect(row.totp_secret.startsWith("v2:")).toBe(true);
    expect(row.totp_secret).not.toContain(secret);
    expect(row.totp_pending_secret).toBeNull();
    const dump = JSON.stringify(
      worker.d1.db.prepare("SELECT * FROM two_factor_backup_codes").all(),
    );
    for (const code of backupCodes) {
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(parseSecondFactor(code)!.code);
    }
  });

  it("drops an unfinished setup after 15 minutes", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const setup = await post(worker, "/api/account/2fa/setup", account.token, {
      currentAuthKey: account.authKey,
    });
    setTime(T0 + 16 * 60);
    const late = await post(worker, "/api/account/2fa/enable", account.token, {
      currentAuthKey: account.authKey,
      code: await codeAt(stringField(setup.body, "secret"), T0 + 16 * 60),
    });
    expect(late).toMatchObject({ status: 400, body: { code: "two_factor.setup_expired" } });
  });
});

describe("sign-in with two factors", () => {
  it("withholds the session and vault key until the code checks out", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);

    setTime(T0 + 60);
    const first = await login(worker, account.authKey);
    expect(first.status).toBe(200);
    const challenge = stringField(first.body, "challenge");
    expect(first.body).toEqual({
      twoFactor: "required",
      challenge,
      expiresAt: T0 + 60 + 300,
    });
    expect(first.body).not.toHaveProperty("token");
    expect(first.body).not.toHaveProperty("wrappedVaultKey");

    const wrong = await secondStep(worker, stringField(first.body, "challenge"), "123456");
    expect(wrong).toMatchObject({ status: 401, body: { code: "auth.invalid_2fa" } });

    const done = await secondStep(
      worker,
      stringField(first.body, "challenge"),
      await codeAt(secret, T0 + 60),
    );
    expect(done.status).toBe(200);
    expect(done.body.wrappedVaultKey).toEqual(account.wrappedVaultKey);
    expect(
      (await worker.fetch("/api/account/2fa", { token: stringField(done.body, "token") })).status,
    ).toBe(200);

    const again = await secondStep(
      worker,
      stringField(first.body, "challenge"),
      await codeAt(secret, T0 + 90),
    );
    expect(again).toMatchObject({ status: 401, body: { code: "auth.two_factor_expired" } });
  });

  it("rejects a code that was already used", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);
    setTime(T0 + 120);
    const code = await codeAt(secret, T0 + 120);
    const first = await login(worker, account.authKey);
    expect((await secondStep(worker, stringField(first.body, "challenge"), code)).status).toBe(200);
    const second = await login(worker, account.authKey);
    const replay = await secondStep(worker, stringField(second.body, "challenge"), code);
    expect(replay).toMatchObject({ status: 401, body: { code: "auth.invalid_2fa" } });
    setTime(T0 + 150);
    const next = await secondStep(
      worker,
      stringField(second.body, "challenge"),
      await codeAt(secret, T0 + 150),
    );
    expect(next.status).toBe(200);
  });

  it("accepts the previous and next 30-second window, nothing further", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);
    const now = T0 + 600;
    setTime(now);
    for (const [offset, status] of [
      [-60, 401],
      [60, 401],
      [-30, 200],
      [30, 200],
    ] as const) {
      const step = await login(worker, account.authKey);
      const result = await secondStep(
        worker,
        stringField(step.body, "challenge"),
        await codeAt(secret, now + offset),
      );
      expect(result.status, `offset ${offset}`).toBe(status);
    }
  });

  it("takes each backup code once, in any format", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { backupCodes } = await enable(worker, account);
    const code = backupCodes[3]!;

    const first = await login(worker, account.authKey);
    const typed = ` ${code.toUpperCase().replace("-", " ")} `;
    expect((await secondStep(worker, stringField(first.body, "challenge"), typed)).status).toBe(
      200,
    );

    const second = await login(worker, account.authKey);
    const reused = await secondStep(worker, stringField(second.body, "challenge"), code);
    expect(reused).toMatchObject({ status: 401, body: { code: "auth.invalid_2fa" } });
    const status = await json(await worker.fetch("/api/account/2fa", { token: account.token }));
    expect(numberField(status.body, "backupCodesLeft")).toBe(9);
  });

  it("expires the challenge after five minutes", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);
    const first = await login(worker, account.authKey);
    setTime(T0 + 301);
    const late = await secondStep(
      worker,
      stringField(first.body, "challenge"),
      await codeAt(secret, T0 + 301),
    );
    expect(late).toMatchObject({ status: 401, body: { code: "auth.two_factor_expired" } });
  });

  it("burns a challenge after five wrong codes", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);
    setTime(T0 + 60);
    const first = await login(worker, account.authKey);
    for (let i = 0; i < 5; i++) {
      expect(
        (await secondStep(worker, stringField(first.body, "challenge"), "000000")).status,
      ).toBe(401);
    }
    const burned = await secondStep(
      worker,
      stringField(first.body, "challenge"),
      await codeAt(secret, T0 + 60),
    );
    expect(burned.body.code).toBe("auth.two_factor_expired");
  });

  it("throttles wrong codes with the same budget as wrong passwords", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret } = await enable(worker, account);
    const ip = "198.51.100.7";
    setTime(T0 + 60);
    let challenge = stringField((await login(worker, account.authKey, { ip })).body, "challenge");
    const wrongs: number[] = [];
    for (let i = 0; i < 6; i++) {
      wrongs.push((await secondStep(worker, challenge, "000000", ip)).status);
      if (i === 3) {
        challenge = stringField((await login(worker, account.authKey, { ip })).body, "challenge");
      }
    }
    expect(wrongs).toEqual([401, 401, 401, 401, 401, 401]);
    const blocked = await secondStep(worker, challenge, await codeAt(secret, T0 + 60), ip);
    expect(blocked).toMatchObject({ status: 429, body: { code: "auth.rate_limited" } });
    const password = await login(worker, account.authKey, { ip });
    expect(password.status).toBe(429);
  });

  it("answers wrong passwords and unknown addresses exactly as before", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    await enable(worker, account);
    const wrong = await login(worker, wrongKey());
    const unknown = await login(worker, wrongKey(), { email: "nobody@example.com" });
    expect(wrong).toEqual(unknown);
    expect(wrong).toMatchObject({ status: 401, body: { code: "auth.invalid_credentials" } });
  });

  it("does not let a challenge stand in for a session", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    await enable(worker, account);
    const first = await login(worker, account.authKey);
    expect(
      (await worker.fetch("/api/account/2fa", { token: stringField(first.body, "challenge") }))
        .status,
    ).toBe(401);
  });
});

describe("managing two factors", () => {
  it("needs the master password and a code to turn off", async () => {
    const worker = await startWorker({ mailer: true });
    const account = await register(worker);
    const { secret, backupCodes } = await enable(worker, account);
    setTime(T0 + 60);

    const noPassword = await post(worker, "/api/account/2fa/disable", account.token, {
      currentAuthKey: wrongKey(),
      code: await codeAt(secret, T0 + 60),
    });
    expect(noPassword.status).toBe(403);
    const noCode = await post(worker, "/api/account/2fa/disable", account.token, {
      currentAuthKey: account.authKey,
      code: "000000",
    });
    expect(noCode).toMatchObject({ status: 401, body: { code: "auth.invalid_2fa" } });

    const off = await post(worker, "/api/account/2fa/disable", account.token, {
      currentAuthKey: account.authKey,
      code: backupCodes[0],
    });
    expect(off.status).toBe(200);
    const plain = await login(worker, account.authKey);
    expect(stringField(plain.body, "token")).toEqual(expect.any(String));
    expect(worker.d1.db.prepare("SELECT COUNT(*) AS n FROM two_factor_backup_codes").get()).toEqual(
      {
        n: 0,
      },
    );
    await worker.settle();
    expect(worker.mail.map((mail) => mail.subject)).toContain(
      "Two-factor authentication was turned off for your 7key vault",
    );
  });

  it("replaces every backup code when asked for new ones", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const { secret, backupCodes } = await enable(worker, account);
    setTime(T0 + 60);
    const fresh = await post(worker, "/api/account/2fa/backup-codes", account.token, {
      currentAuthKey: account.authKey,
      code: await codeAt(secret, T0 + 60),
    });
    expect(fresh.status).toBe(200);
    expect(stringArrayField(fresh.body, "backupCodes")).toHaveLength(10);

    const step = await login(worker, account.authKey);
    const old = await secondStep(worker, stringField(step.body, "challenge"), backupCodes[1]!);
    expect(old.status).toBe(401);
    const current = await secondStep(
      worker,
      stringField(step.body, "challenge"),
      stringArrayField(fresh.body, "backupCodes")[1]!,
    );
    expect(current.status).toBe(200);
  });

  it("refuses to start over while two factors are on", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    await enable(worker, account);
    const again = await post(worker, "/api/account/2fa/setup", account.token, {
      currentAuthKey: account.authKey,
    });
    expect(again).toMatchObject({ status: 409, body: { code: "two_factor.already_enabled" } });
  });
});

describe("account recovery", () => {
  it("bypasses two factors, then turns them off and says so", async () => {
    const worker = await startWorker();
    const account = await register(worker);
    const recovery = {
      authKey: toBase64(randomBytes(32)),
      wrappedVaultKey: { ciphertext: toBase64(randomBytes(48)), nonce: toBase64(randomBytes(12)) },
    };
    const saved = await worker.fetch("/api/account/recovery", {
      method: "PUT",
      token: account.token,
      json: { currentAuthKey: account.authKey, ...recovery },
    });
    expect(saved.status).toBe(200);
    await enable(worker, account);

    const next = record();
    const finished = await worker
      .fetch("/api/auth/recover/finish", {
        method: "POST",
        json: {
          email: EMAIL,
          recoveryAuthKey: recovery.authKey,
          ...next,
          recovery: {
            authKey: toBase64(randomBytes(32)),
            wrappedVaultKey: {
              ciphertext: toBase64(randomBytes(48)),
              nonce: toBase64(randomBytes(12)),
            },
          },
        },
      })
      .then(json);
    expect(finished.body).toEqual({ ok: true, twoFactorDisabled: true });

    const signedIn = await login(worker, next.authKey);
    expect(stringField(signedIn.body, "token")).toEqual(expect.any(String));
    const status = await json(
      await worker.fetch("/api/account/2fa", { token: stringField(signedIn.body, "token") }),
    );
    expect(status.body).toEqual({ enabled: false, enabledAt: null, backupCodesLeft: 0 });
  });
});
