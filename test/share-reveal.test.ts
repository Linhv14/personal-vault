// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardReveal, REVEAL_TIMEOUT_MS } from "../share/reveal.js";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function hideTab() {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("revealed share secrets", () => {
  it("hide again after 30 seconds", () => {
    const hide = vi.fn();
    const guard = guardReveal(hide);
    guard.revealed();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(REVEAL_TIMEOUT_MS).toBe(30_000);
    expect(hide).toHaveBeenCalledOnce();
  });

  it("hide when the tab is hidden", () => {
    const hide = vi.fn();
    guardReveal(hide).revealed();
    hideTab();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("do nothing once hidden by hand", () => {
    const hide = vi.fn();
    const guard = guardReveal(hide);
    guard.revealed();
    guard.hidden();
    hideTab();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS);
    expect(hide).not.toHaveBeenCalled();
  });

  it("restart the countdown when revealed again", () => {
    const hide = vi.fn();
    const guard = guardReveal(hide);
    guard.revealed();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1000);
    guard.revealed();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1000);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(hide).toHaveBeenCalledOnce();
  });
});
