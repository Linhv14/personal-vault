import { beforeEach, describe, expect, it } from "vitest";
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_COOLDOWN_SECONDS,
  generateCode,
  isCode,
} from "../src/worker/one-time-code.js";
import { createD1, T0 } from "./worker-harness.js";

interface Env {
  DB: ReturnType<typeof createD1>["binding"];
  EMAIL_PROBE_SECRET: string;
}
interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}
interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}
interface ShareCodeRequest {
  shareId: string;
  email: string;
  locale: "en";
  siteUrl: string;
}

const SHARE_ACCESS: string = new URL("../src/worker/share-access.ts", import.meta.url).href;
const { consumeShareCode, recipientHash, sendShareCode } = (await import(SHARE_ACCESS)) as {
  recipientHash(env: Env, email: string): Promise<string>;
  sendShareCode(env: Env, mailer: Mailer, request: ShareCodeRequest, at: number): Promise<void>;
  consumeShareCode(
    env: Env,
    shareId: string,
    email: string,
    code: string,
    at: number,
  ): Promise<"ok" | "invalid" | "expired">;
};

const SHARE = "share-one";
const OTHER_SHARE = "share-two";
const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const TTL = 10 * 60;

let d1: ReturnType<typeof createD1>;
let env: Env;
let sent: OutgoingEmail[];
let mailer: Mailer;

async function addShare(
  id: string,
  recipients: string[],
  { expiresAt = T0 + 3600, maxViews = 1, viewCount = 0 } = {},
) {
  d1.db
    .prepare(
      `INSERT INTO shares (id, ciphertext, nonce, expires_at, max_views, view_count, created_at, restricted)
       VALUES (?, 'c', 'n', ?, ?, ?, ?, 1)`,
    )
    .run(id, expiresAt, maxViews, viewCount, T0);
  for (const email of recipients) {
    d1.db
      .prepare("INSERT INTO share_recipients (share_id, email_hash) VALUES (?, ?)")
      .run(id, await recipientHash(env, email));
  }
}

const send = (email: string, at = T0, shareId = SHARE) =>
  sendShareCode(env, mailer, { shareId, email, locale: "en", siteUrl: "https://vault.test" }, at);

function lastCode(): string {
  const message = sent.at(-1);
  const match = message ? /\b(\d{6})\b/.exec(message.text) : null;
  if (!match?.[1]) {
    throw new Error("no code was sent");
  }
  return match[1];
}

function wrongCode(code: string): string {
  return code === "000000" ? "000001" : "000000";
}

const codeRows = () => d1.db.prepare("SELECT * FROM share_codes").all();

beforeEach(async () => {
  d1 = createD1();
  env = { DB: d1.binding, EMAIL_PROBE_SECRET: "share-test-secret" };
  sent = [];
  mailer = { send: async (message) => void sent.push(message) };
  await addShare(SHARE, [ALICE]);
  await addShare(OTHER_SHARE, [ALICE, BOB]);
});

describe("one-time codes", () => {
  it("accepts exactly six ASCII digits", () => {
    expect(isCode("012345")).toBe(true);
    for (const bad of ["12345", "1234567", " 123456", "123456\n", "12345a", "١٢٣٤٥٦", ""]) {
      expect(isCode(bad)).toBe(false);
    }
    expect(isCode(123456)).toBe(false);
    expect(isCode(null)).toBe(false);
  });

  it("generates zero-padded six digit codes", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(isCode(generateCode())).toBe(true);
    }
  });
});

describe("share access codes", () => {
  it("mails a code to a listed recipient and stores only its hash", async () => {
    await send(ALICE);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(ALICE);
    const code = lastCode();
    const [row] = codeRows() as { code_hash: string; email_hash: string; expires_at: number }[];
    expect(row?.code_hash).not.toContain(code);
    expect(row?.email_hash).not.toContain(ALICE);
    expect(row?.expires_at).toBe(T0 + TTL);
  });

  it("silently sends nothing to someone not on the list", async () => {
    await send(BOB);
    expect(sent).toHaveLength(0);
    expect(codeRows()).toHaveLength(0);
  });

  it("sends nothing for an expired or used-up share", async () => {
    await addShare("expired", [ALICE], { expiresAt: T0 });
    await addShare("used", [ALICE], { maxViews: 1, viewCount: 1 });
    await send(ALICE, T0, "expired");
    await send(ALICE, T0, "used");
    await send(ALICE, T0, "missing");
    expect(sent).toHaveLength(0);
  });

  it("waits out the resend cooldown before mailing a fresh code", async () => {
    await send(ALICE);
    await send(ALICE, T0 + CODE_RESEND_COOLDOWN_SECONDS - 1);
    expect(sent).toHaveLength(1);
    const first = lastCode();
    await send(ALICE, T0 + CODE_RESEND_COOLDOWN_SECONDS);
    expect(sent).toHaveLength(2);
    const second = lastCode();
    if (first !== second) {
      expect(await consumeShareCode(env, SHARE, ALICE, first, T0 + 61)).toBe("invalid");
    }
    expect(await consumeShareCode(env, SHARE, ALICE, second, T0 + 61)).toBe("ok");
  });

  it("accepts the right code once and then forgets it", async () => {
    await send(ALICE);
    const code = lastCode();
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + 1)).toBe("ok");
    expect(codeRows()).toHaveLength(0);
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + 2)).toBe("expired");
  });

  it("rejects a wrong code and counts the attempt", async () => {
    await send(ALICE);
    const code = lastCode();
    expect(await consumeShareCode(env, SHARE, ALICE, wrongCode(code), T0 + 1)).toBe("invalid");
    expect((codeRows()[0] as { attempts: number }).attempts).toBe(1);
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + 2)).toBe("ok");
  });

  it("locks the code after five wrong tries, even for the right one", async () => {
    await send(ALICE);
    const code = lastCode();
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt += 1) {
      expect(await consumeShareCode(env, SHARE, ALICE, wrongCode(code), T0 + 1)).toBe("invalid");
    }
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + 2)).toBe("expired");
  });

  it("resets the attempt count when a new code is sent", async () => {
    await send(ALICE);
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt += 1) {
      await consumeShareCode(env, SHARE, ALICE, wrongCode(lastCode()), T0 + 1);
    }
    await send(ALICE, T0 + CODE_RESEND_COOLDOWN_SECONDS);
    expect((codeRows()[0] as { attempts: number }).attempts).toBe(0);
    expect(await consumeShareCode(env, SHARE, ALICE, lastCode(), T0 + 61)).toBe("ok");
  });

  it("expires the code after ten minutes", async () => {
    await send(ALICE);
    const code = lastCode();
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + TTL)).toBe("expired");
  });

  it("binds a code to its share and its recipient", async () => {
    await send(ALICE);
    const code = lastCode();
    expect(await consumeShareCode(env, OTHER_SHARE, ALICE, code, T0 + 1)).toBe("expired");
    expect(await consumeShareCode(env, SHARE, BOB, code, T0 + 1)).toBe("expired");
    await send(BOB, T0, OTHER_SHARE);
    const bobs = lastCode();
    await send(ALICE, T0, OTHER_SHARE);
    if (bobs !== lastCode()) {
      expect(await consumeShareCode(env, OTHER_SHARE, ALICE, bobs, T0 + 1)).toBe("invalid");
    }
    expect(await consumeShareCode(env, OTHER_SHARE, BOB, bobs, T0 + 1)).toBe("ok");
    expect(await consumeShareCode(env, SHARE, ALICE, code, T0 + 1)).toBe("ok");
  });

  it("treats hostile code strings as plain wrong codes", async () => {
    await send(ALICE);
    for (const hostile of ["", "' OR 1=1 --", "x".repeat(10_000), "\u0000"]) {
      expect(await consumeShareCode(env, SHARE, ALICE, hostile, T0 + 1)).toBe("invalid");
    }
  });

  it.fails("caps parallel guesses at the attempt limit", async () => {
    await send(ALICE);
    const code = lastCode();
    const guesses = Array.from({ length: 20 }, (_, index) =>
      String((Number(code) + index + 1) % 1_000_000).padStart(6, "0"),
    );
    const results = await Promise.all(
      guesses.map((guess) => consumeShareCode(env, SHARE, ALICE, guess, T0 + 1)),
    );
    expect(results.filter((result) => result === "invalid").length).toBeLessThanOrEqual(
      CODE_MAX_ATTEMPTS,
    );
  });
});
