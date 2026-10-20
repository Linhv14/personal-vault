import { keyedHash } from "./keyed-hash.js";
import type { Env } from "./types.js";
import {
  accountDelayMs,
  pairDelaySeconds,
  PAIR_MEMORY_SECONDS,
  ACCOUNT_WINDOW_SECONDS,
} from "./throttle-policy.js";

export type ThrottleScope = "login" | "recovery" | "two_factor";

interface Row {
  key: string;
  failures: number;
  window_start: number;
  blocked_until: number;
  updated_at: number;
}

export interface Throttle {
  retryAfter: number | null;
  slowdownMs: number;
  slowDown(): Promise<void>;
  fail(): Promise<void>;
  clear(): Promise<void>;
}

export async function throttle(
  env: Env,
  scope: ThrottleScope,
  email: string,
  ip: string,
  timestamp: number,
): Promise<Throttle> {
  const [pairKey, accountKey] = await Promise.all([
    keyedHash(env.EMAIL_PROBE_SECRET, `throttle:${scope}:pair:${email}:${ip}`),
    keyedHash(env.EMAIL_PROBE_SECRET, `throttle:${scope}:account:${email}`),
  ]);
  const { results } = await env.DB.prepare(
    "SELECT key, failures, window_start, blocked_until, updated_at FROM auth_throttle WHERE key IN (?, ?)",
  )
    .bind(pairKey, accountKey)
    .all<Row>();
  const stored = (key: string) => results.find((row) => row.key === key) ?? null;

  const pairRow = stored(pairKey);
  const pair =
    pairRow && timestamp - pairRow.updated_at < PAIR_MEMORY_SECONDS
      ? pairRow
      : { failures: 0, window_start: timestamp, blocked_until: 0 };
  const accountRow = stored(accountKey);
  const account =
    accountRow && timestamp - accountRow.window_start < ACCOUNT_WINDOW_SECONDS
      ? accountRow
      : { failures: 0, window_start: timestamp };

  const slowdownMs = accountDelayMs(account.failures);
  const upsert = (key: string, failures: number, windowStart: number, blockedUntil: number) =>
    env.DB.prepare(
      `INSERT INTO auth_throttle (key, failures, window_start, blocked_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE
         SET failures = excluded.failures,
             window_start = excluded.window_start,
             blocked_until = excluded.blocked_until,
             updated_at = excluded.updated_at`,
    ).bind(key, failures, windowStart, blockedUntil, timestamp);

  return {
    retryAfter: pair.blocked_until > timestamp ? pair.blocked_until - timestamp : null,
    slowdownMs,
    async slowDown() {
      if (slowdownMs > 0) await new Promise((resolve) => setTimeout(resolve, slowdownMs));
    },
    async fail() {
      const failures = pair.failures + 1;
      await env.DB.batch([
        upsert(pairKey, failures, pair.window_start, timestamp + pairDelaySeconds(failures)),
        upsert(accountKey, account.failures + 1, account.window_start, 0),
      ]);
    },
    async clear() {
      await env.DB.prepare("DELETE FROM auth_throttle WHERE key IN (?, ?)")
        .bind(pairKey, accountKey)
        .run();
    },
  };
}
