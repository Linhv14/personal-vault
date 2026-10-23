import https from "node:https";
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthority } from "../cli/agent/certs.js";
import type { Selected, Session } from "../cli/agent/session.js";
import { vaultBackend } from "../cli/mcp/main.js";
import { serveMcp, type McpBackend, type RunResult } from "../cli/mcp/server.js";

const SECRET = "sk_test_51NwRealValueThatMustStayHidden";

interface Client {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string): void;
  onRequest(handler: (message: { id: number; method: string; params: unknown }) => unknown): void;
  close(): Promise<void>;
}

function connect(backend: McpBackend, allowWithoutAsking = false): Client {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = serveMcp({ input, output, backend, version: "test", allowWithoutAsking });
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  let handler: (message: { id: number; method: string; params: unknown }) => unknown = () => ({});
  let buffer = "";
  let next = 1;
  output.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      buffer = buffer.slice(newline + 1);
      if (typeof message.method === "string") {
        const result = handler(message as { id: number; method: string; params: unknown });
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
      } else {
        waiting.get(message.id as number)?.(message);
      }
    }
  });
  return {
    request: (method, params = {}) =>
      new Promise((resolve) => {
        const id = next++;
        waiting.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      }),
    notify: (method) => input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    onRequest: (next) => {
      handler = next;
    },
    close: async () => {
      input.end();
      await done;
    },
  };
}

function fakeBackend(): McpBackend & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    runs,
    setup: async () => ({
      account: "ana@acme.com",
      server: "https://vault.test",
      project: "Payments API",
      environment: "Development",
      scope: "names only",
    }),
    secrets: async () => [
      { name: "STRIPE_KEY", kind: "secret", hosts: ["api.stripe.com"], usable: true },
      { name: "LOG_LEVEL", kind: "variable", hosts: [], usable: true },
    ],
    permission: async () => ["  STRIPE_KEY  → api.stripe.com"],
    run: async (request): Promise<RunResult> => {
      runs.push([request.command, ...request.args]);
      return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
    },
  };
}

async function initialize(client: Client, capabilities: Record<string, unknown> = {}) {
  const reply = await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities,
    clientInfo: { name: "test", version: "1" },
  });
  client.notify("notifications/initialized");
  return reply.result as Record<string, unknown>;
}

describe("7key mcp protocol", () => {
  it("negotiates the protocol and lists three tools, none of which returns a value", async () => {
    const client = connect(fakeBackend());
    const init = await initialize(client);
    expect(init.protocolVersion).toBe("2025-06-18");
    expect(init.serverInfo).toMatchObject({ name: "7key", version: "test" });
    const { tools } = (await client.request("tools/list")).result as { tools: { name: string }[] };
    expect(tools.map((tool) => tool.name)).toEqual([
      "check_setup",
      "list_secrets",
      "run_with_secrets",
    ]);
    const old = await client.request("initialize", { protocolVersion: "2099-01-01" });
    expect((old.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    await client.close();
  });

  it("lists names and hosts", async () => {
    const client = connect(fakeBackend());
    await initialize(client);
    const reply = await client.request("tools/call", { name: "list_secrets", arguments: {} });
    const result = reply.result as { content: { text: string }[]; structuredContent: unknown };
    expect(result.content[0]!.text).toBe("STRIPE_KEY → api.stripe.com\nLOG_LEVEL (variable)");
    await client.close();
  });

  it("refuses to run without a way to ask the user, unless started with --yes", async () => {
    const backend = fakeBackend();
    const client = connect(backend);
    await initialize(client);
    const refused = await client.request("tools/call", {
      name: "run_with_secrets",
      arguments: { command: "true" },
    });
    expect(refused.result).toMatchObject({ isError: true });
    expect(backend.runs).toEqual([]);
    await client.close();

    const allowed = connect(backend, true);
    await initialize(allowed);
    const ran = await allowed.request("tools/call", {
      name: "run_with_secrets",
      arguments: { command: "echo", args: ["hi"] },
    });
    expect(ran.result).not.toHaveProperty("isError");
    expect(backend.runs).toEqual([["echo", "hi"]]);
    await allowed.close();
  });

  it("asks the user once through elicitation and honours a decline", async () => {
    const backend = fakeBackend();
    const client = connect(backend);
    await initialize(client, { elicitation: {} });
    const prompts: string[] = [];
    let allow = false;
    client.onRequest((message) => {
      prompts.push((message.params as { message: string }).message);
      return allow ? { action: "accept", content: { allow: true } } : { action: "decline" };
    });
    const declined = await client.request("tools/call", {
      name: "run_with_secrets",
      arguments: { command: "true" },
    });
    expect(declined.result).toMatchObject({ isError: true });
    expect(prompts[0]).toContain("STRIPE_KEY  → api.stripe.com");
    allow = true;
    for (let i = 0; i < 2; i++) {
      await client.request("tools/call", {
        name: "run_with_secrets",
        arguments: { command: "true" },
      });
    }
    expect(prompts).toHaveLength(2);
    expect(backend.runs).toHaveLength(2);
    await client.close();
  });

  it("answers unknown methods and malformed input with JSON-RPC errors", async () => {
    const client = connect(fakeBackend());
    await initialize(client);
    const unknown = await client.request("resources/list");
    expect(unknown.error).toMatchObject({ code: -32601 });
    const bad = await client.request("tools/call", {
      name: "run_with_secrets",
      arguments: { command: "echo", args: [1] },
    });
    expect(bad.result).toMatchObject({ isError: true });
    await client.close();
  });
});

describe("7key mcp with the vault proxy", () => {
  const upstreamAuthority = createAuthority("test upstream");
  const seen: string[] = [];
  let upstream: https.Server;
  let port: number;
  let backend: ReturnType<typeof vaultBackend>;

  beforeAll(async () => {
    upstream = https.createServer(
      {
        SNICallback: (host, done) =>
          done(null, tls.createSecureContext(upstreamAuthority.issue(host))),
        ...upstreamAuthority.issue("api.stripe.test"),
      },
      (request, response) => {
        seen.push(String(request.headers.authorization));
        response.end(JSON.stringify({ echoed: request.headers.authorization }));
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
    const session: Session = {
      server: "https://vault.test",
      token: "t",
      identity: { publicKey: "", privateKey: new Uint8Array() },
      request: async () => new Response("{}"),
    };
    const selected = {
      orgId: "o",
      teamId: "t",
      projectId: "p",
      projectName: "Payments API",
      environment: { id: "e", name: "Development" },
      secrets: [
        { name: "STRIPE_KEY", value: SECRET, hosts: ["api.stripe.test"] },
        { name: "NO_HOSTS_KEY", value: "sk_test_withoutanyhosts" },
      ],
    } as unknown as Selected;
    backend = vaultBackend(
      session,
      "ana@acme.com",
      async () => selected,
      () => {},
      {
        upstreamCa: upstreamAuthority.cert,
        resolve: () => "127.0.0.1",
      },
    );
  });

  afterAll(async () => {
    await backend.close();
    upstream.close();
  });

  it("lists names without values and explains why a secret is not usable", async () => {
    const secrets = await backend.secrets();
    expect(JSON.stringify(secrets)).not.toContain(SECRET);
    expect(secrets.find((entry) => entry.name === "NO_HOSTS_KEY")).toMatchObject({
      usable: false,
      reason: expect.stringContaining("no allowed hosts"),
    });
  });

  it("sends the real value to the allowed host while the command only sees a placeholder", async () => {
    const result = await backend.run({
      command: "sh",
      args: [
        "-c",
        `echo "env:$STRIPE_KEY"; curl -sS -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.test:${port}/v1/charges`,
      ],
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(0);
    expect(seen.at(-1)).toBe(`Bearer ${SECRET}`);
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stdout).toMatch(/env:7key-ph-/);
    expect(result.stdout).toMatch(/"echoed":"Bearer 7key-ph-/);
  });

  it("stops a command that runs too long", async () => {
    const result = await backend.run({ command: "sleep", args: ["5"], timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
  });
});
