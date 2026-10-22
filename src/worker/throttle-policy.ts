const FREE_FAILURES = 5;
const BASE_DELAY_SECONDS = 5;
const MAX_PAIR_DELAY_SECONDS = 60 * 60;
export const PAIR_MEMORY_SECONDS = 24 * 60 * 60;
export const ACCOUNT_WINDOW_SECONDS = 60 * 60;
const ACCOUNT_SLOWDOWN_AFTER = 20;
const ACCOUNT_BASE_DELAY_MS = 250;
const MAX_ACCOUNT_DELAY_MS = 5_000;

export function pairDelaySeconds(failures: number): number {
  if (failures <= FREE_FAILURES) {
    return 0;
  }
  return Math.min(MAX_PAIR_DELAY_SECONDS, BASE_DELAY_SECONDS * 2 ** (failures - FREE_FAILURES - 1));
}

export function accountDelayMs(failures: number): number {
  if (failures < ACCOUNT_SLOWDOWN_AFTER) {
    return 0;
  }
  const steps = Math.floor((failures - ACCOUNT_SLOWDOWN_AFTER) / 5);
  return Math.min(MAX_ACCOUNT_DELAY_MS, ACCOUNT_BASE_DELAY_MS * 2 ** steps);
}
