import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "../extension/lib/api.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";

function respond(body: string | null, status: number, type = "application/json"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } })),
  );
}

async function failure(): Promise<ApiError> {
  try {
    await request("/api/config", { auth: false });
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("request did not fail");
}

describe("api client", () => {
  beforeEach(() => {
    usePlatform({
      local: memoryArea({ apiUrl: "https://vault.test" }),
      session: memoryArea(),
      scheduleLock: async () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns an HTML error page into a generic API error with the status", async () => {
    respond("<html><body>502 Bad Gateway</body></html>", 502, "text/html");
    const error = await failure();
    expect(error.messageKey).toBe("error.api.generic");
    expect(error.status).toBe(502);
    expect(error.params).toEqual({ status: 502 });
  });

  it("uses the server's error code and params", async () => {
    respond(JSON.stringify({ code: "auth.rate_limited", params: { seconds: 30 } }), 429);
    const error = await failure();
    expect(error.messageKey).toBe("error.auth.rate_limited");
    expect(error.params).toEqual({ seconds: 30 });
  });

  it("rejects a successful response that is not JSON", async () => {
    respond("not json", 200, "text/plain");
    const error = await failure();
    expect(error.messageKey).toBe("error.api.generic");
  });

  it("returns parsed JSON on success and null for an empty body", async () => {
    respond(JSON.stringify({ ok: true }), 200);
    await expect(request("/api/config", { auth: false })).resolves.toEqual({ ok: true });
    respond(null, 204);
    await expect(request("/api/config", { auth: false })).resolves.toBeNull();
  });
});
