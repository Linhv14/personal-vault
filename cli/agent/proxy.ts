import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { hostAllowed } from "../../src/core/projects.js";
import type { Authority } from "./certs.js";
import {
  longestValue,
  scrub,
  substitute,
  substituteHeader,
  type Injectable,
} from "./substitute.js";

export interface ProxyOptions {
  injectables: readonly Injectable[];
  authority: Authority;
  upstreamCa?: string;
  resolve?: (host: string) => string;
  onUse?: (entry: Injectable, host: string) => void;
}

export interface RunningProxy {
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const FLUSH_DELAY_MS = 30;
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function refuse(socket: net.Socket, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

export async function startProxy(options: ProxyOptions): Promise<RunningProxy> {
  const { injectables, authority } = options;
  const lookup = options.resolve ?? ((host: string) => host);
  const injects = (host: string) => injectables.some((entry) => hostAllowed(entry.hosts, host));
  const holdBack = Math.max(0, longestValue(injectables) - 1);
  const sockets = new Set<net.Socket>();

  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  async function forward(
    request: IncomingMessage,
    response: ServerResponse,
    host: string,
    port: number,
  ): Promise<void> {
    const used = new Set<Injectable>();
    const note = (entries: Injectable[]) => entries.forEach((entry) => used.add(entry));
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_HEADERS.has(name)) continue;
      if (Array.isArray(value)) {
        headers[name] = value.map((item) => {
          const replaced = substituteHeader(name, item, injectables, host);
          note(replaced.used);
          return replaced.value;
        });
      } else {
        const replaced = substituteHeader(name, value, injectables, host);
        note(replaced.used);
        headers[name] = replaced.value;
      }
    }
    const path = substitute(request.url ?? "/", injectables, host);
    note(path.used);
    const body = substitute((await readBody(request)).toString("latin1"), injectables, host);
    note(body.used);
    const payload = Buffer.from(body.text, "latin1");
    headers["accept-encoding"] = "identity";
    headers.host = port === 443 ? host : `${host}:${port}`;
    if (payload.length > 0 || "content-length" in headers) {
      headers["content-length"] = String(payload.length);
    }
    for (const entry of used) options.onUse?.(entry, host);

    const upstream = https.request(
      {
        host: lookup(host),
        port,
        servername: host,
        method: request.method,
        path: path.text,
        headers,
        ...(options.upstreamCa ? { ca: options.upstreamCa } : {}),
      },
      (reply) => {
        const replyHeaders = { ...reply.headers };
        delete replyHeaders["content-length"];
        for (const name of Object.keys(replyHeaders)) {
          if (HOP_HEADERS.has(name)) delete replyHeaders[name];
        }
        for (const name of Object.keys(replyHeaders)) {
          const value = replyHeaders[name];
          if (typeof value === "string") replyHeaders[name] = scrub(value, injectables);
        }
        response.writeHead(reply.statusCode ?? 502, reply.statusMessage, replyHeaders);
        let carry = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          if (carry) response.write(Buffer.from(scrub(carry, injectables), "latin1"));
          carry = "";
        };
        reply.on("data", (chunk: Buffer) => {
          clearTimeout(timer);
          const text = scrub(carry + chunk.toString("latin1"), injectables);
          const cut = Math.max(0, text.length - holdBack);
          response.write(Buffer.from(text.slice(0, cut), "latin1"));
          carry = text.slice(cut);
          timer = setTimeout(flush, FLUSH_DELAY_MS);
        });
        reply.on("end", () => {
          clearTimeout(timer);
          flush();
          response.end();
        });
        reply.on("error", () => response.destroy());
      },
    );
    upstream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
      }
      response.end(`7key agent proxy: ${error.message}\n`);
    });
    upstream.end(payload);
  }

  const inner = http.createServer((request, response) => {
    const socket = request.socket as tls.TLSSocket & { target?: { host: string; port: number } };
    const target = socket.target;
    if (!target) {
      response.writeHead(400).end();
      return;
    }
    forward(request, response, target.host, target.port).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end(`7key agent proxy: ${error instanceof Error ? error.message : error}\n`);
    });
  });

  const server = http.createServer((request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const headers = { ...request.headers };
    for (const name of HOP_HEADERS) delete headers[name];
    const upstream = http.request(
      {
        host: url.hostname,
        port: url.port || 80,
        method: request.method,
        path: url.pathname + url.search,
        headers,
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });

  server.on("connection", track);
  server.on("connect", (request: IncomingMessage, client: net.Socket, head: Buffer) => {
    const [host = "", portText = "443"] = (request.url ?? "").split(/:(?=\d+$)/);
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      refuse(client, "400 Bad Request");
      return;
    }
    if (!injects(host)) {
      const remote = net.connect(port, lookup(host), () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) remote.write(head);
        remote.pipe(client);
        client.pipe(remote);
      });
      track(remote);
      remote.on("error", () => refuse(client, "502 Bad Gateway"));
      client.on("error", () => remote.destroy());
      return;
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) client.unshift(head);
    const issued = authority.issue(host);
    const secure = new tls.TLSSocket(client, {
      isServer: true,
      secureContext: tls.createSecureContext({ cert: issued.cert, key: issued.key }),
      ALPNProtocols: ["http/1.1"],
    }) as tls.TLSSocket & { target?: { host: string; port: number } };
    secure.target = { host, port };
    secure.on("error", () => client.destroy());
    inner.emit("connection", secure);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
