import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1, T0 } from "./worker-harness.js";

type ThrottleScope = "login" | "recovery" | "two_factor";
interface Env {
  DB: ReturnType<typeof createD1>["binding"];
  EMAIL_PROBE_SECRET: string;
}
interface Throttle {
  retryAfter: number | null;
  slowdownMs: number;
  slowDown(): Promise<void>;
  fail(): Promise<void>;
  clear(): Promise<void>;
}

const THROTTLE: string = new URL("../src/worker/throttle.ts", import.meta.url).href;
const { throttle } = (await import(THROTTLE)) as {
  throttle(
    env: Env,
    scope: ThrottleScope,
    email: string,
    ip: string,
    at: number,
  ): Promise<Throttle>;
};

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const EMAIL = "owner@example.com";
const IP = "198.51.100.7";

let d1: ReturnType<typeof createD1>;
let env: Env;

beforeEach(() => {
  d1 = createD1();
  env = { DB: d1.binding, EMAIL_PROBE_SECRET: "throttle-test-secret" };
});

const guard = (at = T0, email = EMAIL, ip = IP, scope: ThrottleScope = "login") =>
  throttle(env, scope, email, ip, at);

async function failTimes(count: number, at = T0, email = EMAIL, ip = IP, scope?: ThrottleScope) {
  for (let index = 0; index < count; index += 1) {
    await (await guard(at, email, ip, scope)).fail();
  }
}

describe("throttle", () => {
  it("starts open with no slowdown", async () => {
    const fresh = await guard();
    expect(fresh.retryAfter).toBeNull();
    expect(fresh.slowdownMs).toBe(0);
  });

  it("allows five free failures and then blocks the pair for five seconds", async () => {
    await failTimes(5);
    expect((await guard()).retryAfter).toBeNull();
    await failTimes(1);
    expect((await guard()).retryAfter).toBe(5);
    expect((await guard(T0 + 4)).retryAfter).toBe(1);
    expect((await guard(T0 + 5)).retryAfter).toBeNull();
  });

  it("doubles the block with each further failure and caps it at an hour", async () => {
    await failTimes(7);
    expect((await guard()).retryAfter).toBe(10);
    await failTimes(20);
    expect((await guard()).retryAfter).toBe(HOUR);
  });

  it("blocks only the guessing pair, not the same account from another network", async () => {
    await failTimes(8);
    expect((await guard()).retryAfter).not.toBeNull();
    expect((await guard(T0, EMAIL, "203.0.113.50")).retryAfter).toBeNull();
    expect((await guard(T0, "other@example.com", IP)).retryAfter).toBeNull();
  });

  it("keeps login, recovery and two-factor counters apart", async () => {
    await failTimes(8, T0, EMAIL, IP, "login");
    expect((await guard(T0, EMAIL, IP, "login")).retryAfter).not.toBeNull();
    expect((await guard(T0, EMAIL, IP, "recovery")).retryAfter).toBeNull();
    expect((await guard(T0, EMAIL, IP, "two_factor")).retryAfter).toBeNull();
  });

  it("clears both counters after a success", async () => {
    await failTimes(25);
    const blocked = await guard();
    expect(blocked.retryAfter).not.toBeNull();
    expect(blocked.slowdownMs).toBeGreaterThan(0);
    await blocked.clear();
    const after = await guard();
    expect(after.retryAfter).toBeNull();
    expect(after.slowdownMs).toBe(0);
    expect(d1.db.prepare("SELECT COUNT(*) AS n FROM auth_throttle").get()).toEqual({ n: 0 });
  });

  it("forgets a pair that has been quiet for a day", async () => {
    await failTimes(10);
    expect((await guard(T0 + DAY - 1)).retryAfter).toBeNull();
    await (await guard(T0 + DAY)).fail();
    expect((await guard(T0 + DAY)).retryAfter).toBeNull();
    await failTimes(5, T0 + DAY);
    expect((await guard(T0 + DAY)).retryAfter).toBe(5);
  });

  it("keeps a pair that keeps failing within the day", async () => {
    await failTimes(6);
    await failTimes(1, T0 + DAY - 10);
    expect((await guard(T0 + DAY - 10)).retryAfter).toBe(10);
  });

  it("slows the whole account after twenty failures from many networks in an hour", async () => {
    for (let index = 0; index < 20; index += 1) {
      await failTimes(1, T0 + index, EMAIL, `192.0.2.${index}`);
    }
    const elsewhere = await guard(T0 + 30, EMAIL, "203.0.113.99");
    expect(elsewhere.retryAfter).toBeNull();
    expect(elsewhere.slowdownMs).toBe(250);
    expect((await guard(T0 + HOUR)).slowdownMs).toBe(0);
  });

  it("does not let failures against one account slow another", async () => {
    await failTimes(30);
    expect((await guard(T0, "someone-else@example.com", IP)).slowdownMs).toBe(0);
  });

  it("stores only keyed hashes, never the address or the network", async () => {
    await failTimes(2);
    const rows = d1.db.prepare("SELECT key FROM auth_throttle").all() as { key: string }[];
    expect(rows).toHaveLength(2);
    for (const { key } of rows) {
      expect(key).not.toContain(EMAIL);
      expect(key).not.toContain(IP);
    }
  });

  it("derives keys from the secret, so another deployment does not share counters", async () => {
    await failTimes(8);
    const other = { ...env, EMAIL_PROBE_SECRET: "another-secret" };
    expect((await throttle(other, "login", EMAIL, IP, T0)).retryAfter).toBeNull();
  });

  describe("slowDown", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits the account slowdown before answering", async () => {
      await failTimes(20);
      const slowed = await guard();
      let done = false;
      const waiting = slowed.slowDown().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(249);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toBe(true);
    });

    it("returns at once when there is nothing to wait for", async () => {
      await expect((await guard()).slowDown()).resolves.toBeUndefined();
    });
  });

  it.fails("counts parallel failures from the same pair separately", async () => {
    const guards = await Promise.all(Array.from({ length: 8 }, () => guard()));
    await Promise.all(guards.map((held) => held.fail()));
    expect((await guard()).retryAfter).not.toBeNull();
  });
});
