import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export const METHOD_NOT_FOUND = -32601;
const PARSE_ERROR = -32700;
const CLOSED = -32000;

export type Handler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface Connection {
  request(method: string, params: Record<string, unknown>): Promise<JsonRpcMessage>;
  closed: Promise<void>;
}

export function connect(options: {
  input: Readable;
  output: Writable;
  handle: Handler;
  log?: (line: string) => void;
}): Connection {
  const pending = new Map<number, (reply: JsonRpcMessage) => void>();
  let nextId = 1;
  const send = (payload: JsonRpcMessage) => {
    options.output.write(`${JSON.stringify(payload)}\n`);
  };

  const answer = async (message: JsonRpcMessage) => {
    const { id, method = "", params = {} } = message;
    try {
      const result = await options.handle(method, params);
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, result });
      }
    } catch (error) {
      if (id === undefined) {
        options.log?.(`7key mcp: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const code = error instanceof RpcError ? error.code : CLOSED;
      const text = error instanceof Error ? error.message : String(error);
      send({ jsonrpc: "2.0", id, error: { code, message: text } });
    }
  };

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
      return;
    }
    const settle = typeof message.id === "number" ? pending.get(message.id) : undefined;
    if (message.method === undefined && settle) {
      pending.delete(message.id as number);
      settle(message);
      return;
    }
    void answer(message);
  });

  const closed = new Promise<void>((resolve) => {
    lines.on("close", () => {
      for (const settle of pending.values()) {
        settle({ jsonrpc: "2.0", error: { code: CLOSED, message: "closed" } });
      }
      pending.clear();
      resolve();
    });
  });

  return {
    request: (method, params) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        send({ jsonrpc: "2.0", id, method, params });
      }),
    closed,
  };
}
