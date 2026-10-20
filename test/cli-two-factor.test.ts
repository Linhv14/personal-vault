import { beforeAll, describe, expect, it } from "vitest";
import { utf8Encode } from "../src/core/bytes.js";
import { createAccount, seal } from "../src/core/crypto.js";
import { createIdentity } from "../src/core/identity.js";
import { generateTotp } from "../src/core/totp.js";
import { signIn } from "../cli/agent/session.js";
import { REGISTRATION_TOKEN, startWorker, type TestWorker } from "./worker-harness.js";

const EMAIL = "cli-owner@example.com";
const PASSWORD = "a long cli test password";
const SERVER = "https://vault.test";

let worker: TestWorker;
let secret: string;
let backupCodes: string[];
let publicKey: string;

const request = ((input: RequestInfo | URL, init?: RequestInit) =>
  worker.fetch(String(input), init as RequestInit)) as typeof fetch;

function answers(...codes: string[]) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (question: string) => {
      asked.push(question);
      return codes.shift() ?? "";
    },
  };
}

beforeAll(async () => {
  worker = await startWorker();
  const { record, vaultKey } = await createAccount(EMAIL, PASSWORD, 600_000);
  const registered = await worker.fetch("/api/auth/register", {
    method: "POST",
    headers: { "x-registration-token": REGISTRATION_TOKEN },
    json: { email: EMAIL, ...record },
  });
  const { token } = (await registered.json()) as { token: string };
  const identity = await createIdentity();
  publicKey = identity.publicKey;
  await worker.fetch("/api/account/identity", {
    method: "PUT",
    token,
    json: {
      publicKey: identity.publicKey,
      wrappedPrivateKey: await seal(
        vaultKey,
        identity.privateKey,
        utf8Encode("personal-vault/account-private-key"),
      ),
    },
  });
  const setup = await worker.fetch("/api/account/2fa/setup", {
    method: "POST",
    token,
    json: { currentAuthKey: record.authKey },
  });
  secret = ((await setup.json()) as { secret: string }).secret;
  const enabled = await worker.fetch("/api/account/2fa/enable", {
    method: "POST",
    token,
    json: {
      currentAuthKey: record.authKey,
      code: await generateTotp({ secret }, Date.now() - 30_000),
    },
  });
  backupCodes = ((await enabled.json()) as { backupCodes: string[] }).backupCodes;
}, 30_000);

describe("7key login with two-factor authentication", () => {
  it("asks for the code after the master password", async () => {
    const prompt = answers(await generateTotp({ secret }));
    const session = await signIn(SERVER, EMAIL, PASSWORD, request, prompt.ask);
    expect(prompt.asked).toEqual(["2FA code (or backup code): "]);
    expect(session.identity.publicKey).toBe(publicKey);
  }, 30_000);

  it("asks again after a wrong code and accepts a backup code", async () => {
    const prompt = answers("000000", backupCodes[0]!.toUpperCase());
    const session = await signIn(SERVER, EMAIL, PASSWORD, request, prompt.ask);
    expect(prompt.asked).toEqual(["2FA code (or backup code): ", "Wrong code. 2FA code: "]);
    expect(session.token).toEqual(expect.any(String));
  }, 30_000);

  it("gives up after three wrong codes", async () => {
    const prompt = answers("000001", "000002", "000003");
    await expect(signIn(SERVER, EMAIL, PASSWORD, request, prompt.ask)).rejects.toThrow(
      "Wrong 2FA code",
    );
    expect(prompt.asked).toHaveLength(3);
  }, 30_000);

  it("refuses to sign in where nobody can type a code", async () => {
    await expect(signIn(SERVER, EMAIL, PASSWORD, request)).rejects.toThrow(
      "This account uses two-factor authentication",
    );
  }, 30_000);
});
