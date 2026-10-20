import { HAS_PASSWORD_HISTORY, itemType } from "./item-types.js";
import type { VaultItem } from "./vault.js";

export const WEAK_BELOW_BITS = 60;
export const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const BREACH_CHECK_TIMEOUT_MS = 8000;

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiopasdfghjklzxcvbnm"];

function poolSize(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^a-zA-Z\d]/.test(password)) pool += 33;
  return pool;
}

function predictableCharacters(password: string): number {
  const lower = password.toLowerCase();
  let predictable = 0;
  for (let index = 1; index < lower.length; index++) {
    const previous = lower[index - 1] ?? "";
    const current = lower[index] ?? "";
    const repeated = previous === current;
    const sequential = SEQUENCES.some((sequence) => {
      const at = sequence.indexOf(previous);
      return at >= 0 && (sequence[at + 1] === current || sequence[at - 1] === current);
    });
    if (repeated || sequential) predictable++;
  }
  return predictable;
}

export function passwordEntropy(password: string): number {
  if (!password) return 0;
  const effectiveLength = password.length - predictableCharacters(password);
  const bits = effectiveLength * Math.log2(poolSize(password));
  const looksLikeAWord = /^[a-zA-Z]+\d{0,4}[^a-zA-Z\d]?$/.test(password);
  return looksLikeAWord ? Math.min(bits, 30) : bits;
}

export function withPasswords(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => item.password && HAS_PASSWORD_HISTORY.has(itemType(item)));
}

export function weakItems(items: VaultItem[]): VaultItem[] {
  return withPasswords(items).filter(
    (item) => passwordEntropy(item.password ?? "") < WEAK_BELOW_BITS,
  );
}

export function reusedGroups(items: VaultItem[]): VaultItem[][] {
  const byPassword = new Map<string, VaultItem[]>();
  for (const item of withPasswords(items)) {
    const password = item.password ?? "";
    byPassword.set(password, [...(byPassword.get(password) ?? []), item]);
  }
  return [...byPassword.values()].filter((group) => group.length > 1);
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export type FetchRange = (prefix: string) => Promise<string>;

export const fetchBreachRange: FetchRange = async (prefix) => {
  const response = await fetch(`${BREACH_RANGE_URL}${prefix}`, {
    headers: { "Add-Padding": "true" },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Breach check failed with HTTP ${response.status}`);
  return response.text();
};

export async function breachCounts(
  passwords: string[],
  fetchRange: FetchRange = fetchBreachRange,
): Promise<Map<string, number>> {
  const hashes = new Map<string, string>();
  for (const password of new Set(passwords)) hashes.set(password, await sha1Hex(password));

  const prefixes = new Set([...hashes.values()].map((hash) => hash.slice(0, 5)));
  const found = new Map<string, number>();
  for (const prefix of prefixes) {
    for (const line of (await fetchRange(prefix)).split(/\r?\n/)) {
      const [suffix, count] = line.trim().split(":");
      const times = Number(count);
      if (suffix && times > 0) found.set(prefix + suffix.toUpperCase(), times);
    }
  }

  const counts = new Map<string, number>();
  for (const [password, hash] of hashes) {
    const times = found.get(hash);
    if (times) counts.set(password, times);
  }
  return counts;
}
