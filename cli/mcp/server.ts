import type { Readable, Writable } from "node:stream";
import type { McpBackend } from "./backend.js";
import { connect, METHOD_NOT_FOUND, RpcError, type Connection } from "./rpc.js";
import { createTools, INSTRUCTIONS, TOOLS, type Consent } from "./tools.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ServeOptions {
  input: Readable;
  output: Writable;
  backend: McpBackend;
  version: string;
  allowWithoutAsking: boolean;
  log?: (line: string) => void;
}

function negotiate(requested: unknown): string {
  return (PROTOCOL_VERSIONS as readonly unknown[]).includes(requested)
    ? (requested as string)
    : PROTOCOL_VERSIONS[0];
}

async function elicitConsent(connection: Connection, secrets: string[]): Promise<Consent> {
  const reply = await connection.request("elicitation/create", {
    message: `Allow this agent to run commands with these 7key secrets?\n${secrets.join("\n")}\nThe agent sees placeholders; the values only go to the hosts listed.`,
    requestedSchema: {
      type: "object",
      properties: {
        allow: { type: "boolean", title: "Allow for this session", default: false },
      },
      required: ["allow"],
    },
  });
  const result = reply.result as { action?: string; content?: { allow?: unknown } } | undefined;
  return result?.action === "accept" && result.content?.allow === true ? "allowed" : "refused";
}

export function serveMcp(options: ServeOptions): Promise<void> {
  let canElicit = false;
  let connection: Connection | null = null;
  const tools = createTools({
    backend: options.backend,
    allowWithoutAsking: options.allowWithoutAsking,
    askConsent: (secrets) =>
      canElicit && connection
        ? elicitConsent(connection, secrets)
        : Promise.resolve<Consent>("unsupported"),
  });

  connection = connect({
    input: options.input,
    output: options.output,
    log: options.log,
    handle: async (method, params) => {
      switch (method) {
        case "initialize": {
          const capabilities = (params.capabilities ?? {}) as Record<string, unknown>;
          canElicit =
            typeof capabilities.elicitation === "object" && capabilities.elicitation !== null;
          return {
            protocolVersion: negotiate(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "7key", title: "7key", version: options.version },
            instructions: INSTRUCTIONS,
          };
        }
        case "ping":
          return {};
        case "tools/list":
          return { tools: TOOLS };
        case "tools/call":
          return tools.call(params.name, (params.arguments ?? {}) as Record<string, unknown>);
        default:
          if (method.startsWith("notifications/")) {
            return undefined;
          }
          throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    },
  });
  return connection.closed;
}
