import { randomBytes, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { hostAllowed } from "../../src/core/projects.js";
import type { Authority } from "./certs.js";
import { Scrubber, substituteHeader, type Injectable } from "./substitute.js";

export interface ProxyOptions {
  injectables: readonly Injectable[];
  authority: Authority;
  upstreamCa?: string;
  resolve?: (host: string) => string;
  onUse?: (entry: Injectable, host: string) => void;
}

export interface RunningProxy {
  port: number;
  url: string;
  close(): Promise<void>;
}

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DECODERS: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: () => zlib.createGunzip(),
  "x-gzip": () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
  ...("createZstdDecompress" in zlib
    ? {
        zstd: () =>
          (
            zlib as unknown as { createZstdDecompress: () => NodeJS.ReadWriteStream }
          ).createZstdDecompress(),
      }
    : {}),
};

function refuse(socket: net.Socket, status: string, extra = ""): void {
  socket.end(`HTTP/1.1 ${status}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
}

export async function startProxy(options: ProxyOptions): Promise<RunningProxy> {
  const { injectables, authority } = options;
  const lookup = options.resolve ?? ((host: string) => host);
  const injects = (host: string) => injectables.some((entry) => hostAllowed(entry.hosts, host));
  const scrubber = new Scrubber(injectables);
  const sockets = new Set<net.Socket>();
  const user = "7key";
  const password = randomBytes(18).toString("base64url");
  const expected = Buffer.from(`Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`);
  const authorized = (request: IncomingMessage) => {
    const given = Buffer.from(request.headers["proxy-authorization"] ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  const challenge = 'Proxy-Authenticate: Basic realm="7key"\r\n';

  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };

  const fail = (response: ServerResponse, message: string) => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain" });
    }
    response.end(`7key agent proxy: ${scrubber.scrub(message)}\n`);
  };

  function relay(reply: IncomingMessage, response: ServerResponse): void {
    const encoding = String(reply.headers["content-encoding"] ?? "identity")
      .trim()
      .toLowerCase();
    let body: Readable = reply;
    if (encoding !== "identity" && encoding !== "") {
      const decoder = DECODERS[encoding];
      if (!decoder) {
        reply.destroy();
        fail(response, `refused a response with content-encoding ${encoding}`);
        return;
      }
      body = reply.pipe(decoder()) as unknown as Readable;
    }
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value === undefined || HOP_HEADERS.has(name)) {
        continue;
      }
      if (name === "content-length" || name === "content-encoding") {
        continue;
      }
      headers[name] = Array.isArray(value)
        ? value.map((item) => scrubber.scrub(item))
        : scrubber.scrub(value);
    }
    response.writeHead(reply.statusCode ?? 502, reply.statusMessage, headers);
    let pending = "";
    body.on("data", (chunk: Buffer) => {
      const { ready, pending: rest } = scrubber.split(pending + chunk.toString("latin1"));
      if (ready) {
        response.write(Buffer.from(ready, "latin1"));
      }
      pending = rest;
    });
    body.on("end", () => {
      response.end(Buffer.from(scrubber.scrub(pending), "latin1"));
    });
    body.on("error", () => response.destroy());
  }

  function forward(
    request: IncomingMessage,
    response: ServerResponse,
    host: string,
    port: number,
  ): void {
    const used = new Set<Injectable>();
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_HEADERS.has(name)) {
        continue;
      }
      const swap = (item: string) => {
        const replaced = substituteHeader(name, item, injectables, host);
        replaced.used.forEach((entry) => used.add(entry));
        return replaced.value;
      };
      headers[name] = Array.isArray(value) ? value.map(swap) : swap(value);
    }
    headers["accept-encoding"] = "identity";
    headers.host = port === 443 ? host : `${host}:${port}`;
    for (const entry of used) {
      options.onUse?.(entry, host);
    }

    const upstream = https.request(
      {
        host: lookup(host),
        port,
        servername: host,
        method: request.method,
        path: request.url ?? "/",
        headers,
        ...(options.upstreamCa ? { ca: options.upstreamCa } : {}),
      },
      (reply) => relay(reply, response),
    );
    upstream.on("error", (error) => fail(response, error.message));
    request.pipe(upstream);
  }

  const inner = http.createServer((request, response) => {
    const socket = request.socket as tls.TLSSocket & { target?: { host: string; port: number } };
    const target = socket.target;
    if (!target) {
      response.writeHead(400).end();
      return;
    }
    forward(request, response, target.host, target.port);
  });

  const server = http.createServer((request, response) => {
    if (!authorized(request)) {
      response.writeHead(407, { "proxy-authenticate": 'Basic realm="7key"' }).end();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const headers = { ...request.headers };
    for (const name of HOP_HEADERS) {
      delete headers[name];
    }
    const upstream = http.request(
      {
        host: lookup(url.hostname),
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
      if (!response.headersSent) {
        response.writeHead(502);
      }
      response.end();
    });
    request.pipe(upstream);
  });

  server.on("connection", track);
  server.on("connect", (request: IncomingMessage, client: net.Socket, head: Buffer) => {
    if (!authorized(request)) {
      refuse(client, "407 Proxy Authentication Required", challenge);
      return;
    }
    const [host = "", portText = "443"] = (request.url ?? "").split(/:(?=\d+$)/);
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      refuse(client, "400 Bad Request");
      return;
    }
    if (!injects(host)) {
      const remote = net.connect(port, lookup(host), () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
          remote.write(head);
        }
        remote.pipe(client);
        client.pipe(remote);
      });
      track(remote);
      remote.on("error", () => refuse(client, "502 Bad Gateway"));
      client.on("error", () => remote.destroy());
      return;
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      client.unshift(head);
    }
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
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://${user}:${password}@127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}
