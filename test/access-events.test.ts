import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteAccess as noteAgentAccess,
  type Selected,
  type Session,
} from "../cli/agent/session.js";
import { toBase64 } from "../src/core/bytes.js";
import { randomKey } from "../src/core/identity.js";
import { memoryArea, usePlatform } from "../extension/lib/platform.js";
import { flushAccess, noteAccess, type Project } from "../extension/lib/projects.js";

const project = { id: "p1", teamId: "t1" } as Project;

function server(statuses: number[]) {
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const status = statuses.shift() ?? 204;
    return status === 0
      ? Promise.reject(new TypeError("network down"))
      : new Response(status === 204 ? null : "{}", { status });
  });
  return { fetch, bodies };
}

describe("extension access events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlatform({
      local: memoryArea({ apiUrl: "https://vault.test" }),
      session: memoryArea({ token: "session", vaultKeyRaw: toBase64(randomKey()) }),
      scheduleLock: async () => {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps events the server could not take and sends them on the next flush", async () => {
    const { fetch, bodies } = server([503, 204]);
    vi.stubGlobal("fetch", fetch);
    noteAccess("o1", project, "dev", "revealed", "s1");
    await flushAccess();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toEqual({ events: [{ environmentId: "dev", access: "revealed" }] });
  });

  it("does not let a retry delay an event noted after the failure", async () => {
    const { fetch, bodies } = server([503, 204]);
    vi.stubGlobal("fetch", fetch);
    noteAccess("o1", project, "dev", "revealed", "s3");
    await flushAccess();
    noteAccess("o1", project, "dev", "copied", "s4");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toEqual({
      events: [
        { environmentId: "dev", access: "revealed" },
        { environmentId: "dev", access: "copied" },
      ],
    });
  });

  it("drops events the server refuses for good", async () => {
    const { fetch } = server([403]);
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    noteAccess("o1", project, "dev", "exported", "s2");
    await flushAccess();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("agent access events", () => {
  const selected = {
    orgId: "o1",
    teamId: "t1",
    projectId: "p1",
    environment: { id: "dev" },
  } as Selected;

  it("retries a failed write and stops once it lands", async () => {
    const { fetch } = server([0, 502, 204]);
    const session = {
      server: "https://vault.test",
      token: "t",
      request: fetch,
    } as unknown as Session;
    await noteAgentAccess(session, selected, "injected", async () => {});
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry an expired session or a rate limit", async () => {
    for (const status of [401, 429]) {
      const { fetch } = server([status]);
      const session = {
        server: "https://vault.test",
        token: "t",
        request: fetch,
      } as unknown as Session;
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await noteAgentAccess(session, selected, "injected", async () => {});
      expect(fetch).toHaveBeenCalledTimes(1);
      write.mockRestore();
    }
  });

  it("warns on stderr instead of failing the command when it cannot record", async () => {
    const { fetch } = server([500, 500, 500]);
    const session = {
      server: "https://vault.test",
      token: "t",
      request: fetch,
    } as unknown as Session;
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await noteAgentAccess(session, selected, "injected", async () => {});
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(write.mock.calls.at(-1)?.[0])).toContain("could not record this access");
    write.mockRestore();
  });
});
