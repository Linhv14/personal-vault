import { beforeEach, describe, expect, it } from "vitest";
import { CODE_MAX_ATTEMPTS } from "../src/worker/one-time-code.js";
import { createD1, T0 } from "./worker-harness.js";

interface Env {
  DB: ReturnType<typeof createD1>["binding"];
  EMAIL_PROBE_SECRET: string;
}
type Result = "ok" | "invalid" | "expired";

const VERIFICATION: string = new URL("../src/worker/email-verification.ts", import.meta.url).href;
const RECOVERY: string = new URL("../src/worker/recovery-email.ts", import.meta.url).href;
const { issueCode, consumeCode } = (await import(VERIFICATION)) as {
  issueCode(env: Env, email: string, at: number): Promise<{ code: string } | "cooldown">;
  consumeCode(env: Env, email: string, code: string, at: number): Promise<Result>;
};
const { issueRecoveryEmailCode, checkRecoveryEmailCode } = (await import(RECOVERY)) as {
  issueRecoveryEmailCode(env: Env, id: string, at: number): Promise<{ code: string } | "cooldown">;
  checkRecoveryEmailCode(env: Env, id: string, code: string, at: number): Promise<Result>;
};

const EMAIL = "new@example.com";
const ACCOUNT = "account-one";

let env: Env;

function wrongGuesses(code: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    String((Number(code) + index + 1) % 1_000_000).padStart(6, "0"),
  );
}

async function issued(result: Promise<{ code: string } | "cooldown">): Promise<string> {
  const value = await result;
  if (value === "cooldown") {
    throw new Error("cooldown");
  }
  return value.code;
}

beforeEach(() => {
  const d1 = createD1();
  env = { DB: d1.binding, EMAIL_PROBE_SECRET: "probe-secret" };
  d1.db
    .prepare(
      `INSERT INTO accounts (id, email, kdf_type, kdf_iterations, kdf_salt, auth_key_hash,
         wrapped_vault_key, wrap_nonce, created_at) VALUES (?, ?, 'pbkdf2-sha256', 600000, 's', 'h', 'w', 'n', ?)`,
    )
    .run(ACCOUNT, "owner@example.com", T0);
});

describe("email verification codes", () => {
  it("caps parallel guesses at the attempt limit", async () => {
    const code = await issued(issueCode(env, EMAIL, T0));
    const results = await Promise.all(
      wrongGuesses(code, 20).map((guess) => consumeCode(env, EMAIL, guess, T0 + 1)),
    );
    expect(results.filter((result) => result === "invalid")).toHaveLength(CODE_MAX_ATTEMPTS);
    expect(await consumeCode(env, EMAIL, code, T0 + 1)).toBe("expired");
  });

  it("accepts the right code once", async () => {
    const code = await issued(issueCode(env, EMAIL, T0));
    expect(await consumeCode(env, EMAIL, code, T0 + 1)).toBe("ok");
    expect(await consumeCode(env, EMAIL, code, T0 + 2)).toBe("expired");
  });
});

describe("account recovery email codes", () => {
  it("caps parallel guesses at the attempt limit", async () => {
    const code = await issued(issueRecoveryEmailCode(env, ACCOUNT, T0));
    const results = await Promise.all(
      wrongGuesses(code, 20).map((guess) => checkRecoveryEmailCode(env, ACCOUNT, guess, T0 + 1)),
    );
    expect(results.filter((result) => result === "invalid")).toHaveLength(CODE_MAX_ATTEMPTS);
    expect(await checkRecoveryEmailCode(env, ACCOUNT, code, T0 + 1)).toBe("expired");
  });

  it("lets the right code pass both recovery steps without using up attempts", async () => {
    const code = await issued(issueRecoveryEmailCode(env, ACCOUNT, T0));
    expect(await checkRecoveryEmailCode(env, ACCOUNT, wrongGuesses(code, 1)[0]!, T0 + 1)).toBe(
      "invalid",
    );
    for (let step = 0; step < CODE_MAX_ATTEMPTS + 1; step++) {
      expect(await checkRecoveryEmailCode(env, ACCOUNT, code, T0 + 2)).toBe("ok");
    }
  });
});
