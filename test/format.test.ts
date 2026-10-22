import { describe, expect, it } from "vitest";
import { formatRelative } from "../extension/ui/format.js";

const NOW_MS = Date.UTC(2026, 0, 15, 12);
const now = NOW_MS / 1000;

describe("formatRelative", () => {
  it("describes times relative to now", () => {
    expect(formatRelative(now - 7200, "en", { now: NOW_MS })).toBe("2 hours ago");
    expect(formatRelative(now + 3 * 86400, "en", { now: NOW_MS })).toBe("in 3 days");
    expect(formatRelative(now - 40 * 86400, "en", { now: NOW_MS })).toBe("last month");
  });

  it("says now for under a minute by default", () => {
    expect(formatRelative(now - 30, "en", { now: NOW_MS })).toBe("now");
  });

  it("can round under a minute to this minute", () => {
    expect(formatRelative(now, "en", { now: NOW_MS, smallest: "minute" })).toBe("this minute");
  });
});
