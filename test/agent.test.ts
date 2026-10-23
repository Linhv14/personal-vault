import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import zlib from "node:zlib";
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostAllowed, normalizeHost, parseHosts } from "../src/core/projects.js";
import { createAuthority, verifies } from "../cli/agent/certs.js";
import { parseAgentArgs } from "../cli/agent/main.js";
import { startProxy, type RunningProxy } from "../cli/agent/proxy.js";
import { plan } from "../cli/agent/plan.js";
import { childEnvironment } from "../cli/agent/sandbox.js";
import {
  scrub,
  Scrubber,
  substitute,
  substituteHeader,
  type Injectable,
} from "../cli/agent/substitute.js";

const run = promisify(execFile);

const STRIPE: Injectable = {
  name: "STRIPE_KEY",
  value: "sk_live_real_value_123",
  hosts: ["api.stripe.test"],
  placeholder: "7key-ph-aaaaaaaaaaaaaaaaaaaaaaaa",
};
const SHOP: Injectable = {
  name: "SHOP_TOKEN",
  value: "shpat_real_token_456",
  hosts: ["*.myshop.test"],
  placeholder: "7key-ph-bbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("allowed hosts", () => {
  it("normalizes hosts and wildcards, refusing bare names, addresses and top-level wildcards", () => {
    expect(normalizeHost(" API.Stripe.com. ")).toBe("api.stripe.com");
    expect(normalizeHost("*.myshopify.com")).toBe("*.myshopify.com");
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("10.0.0.1")).toBeNull();
    expect(normalizeHost("*.com")).toBeNull();
    for (const shared of [
      "*.co.uk",
      "*.com.vn",
      "*.github.io",
      "*.amazonaws.com",
      "*.s3.amazonaws.com",
      "*.vercel.app",
    ]) {
      expect(normalizeHost(shared)).toBeNull();
    }
    expect(normalizeHost("my-app.vercel.app")).toBe("my-app.vercel.app");
    expect(normalizeHost("*.example.co.uk")).toBe("*.example.co.uk");
    expect(normalizeHost("https://api.stripe.com")).toBeNull();
    expect(parseHosts("api.stripe.com, *.myshopify.com\napi.stripe.com")).toEqual([
      "api.stripe.com",
      "*.myshopify.com",
    ]);
    expect(parseHosts("api.stripe.com bad_host")).toBeNull();
  });

  it("matches a wildcard on subdomains only", () => {
    expect(hostAllowed(["*.myshop.test"], "a.myshop.test")).toBe(true);
    expect(hostAllowed(["*.myshop.test"], "myshop.test")).toBe(false);
    expect(hostAllowed(["*.myshop.test"], "evilmyshop.test")).toBe(false);
    expect(hostAllowed(["api.stripe.test"], "API.stripe.test")).toBe(true);
    expect(hostAllowed(undefined, "api.stripe.test")).toBe(false);
  });
});

describe("placeholders", () => {
  it("swaps a placeholder only for a host allowed for that secret", () => {
    const body = `{"a":"${STRIPE.placeholder}","b":"${SHOP.placeholder}"}`;
    const toStripe = substitute(body, [STRIPE, SHOP], "api.stripe.test");
    expect(toStripe.text).toBe(`{"a":"${STRIPE.value}","b":"${SHOP.placeholder}"}`);
    expect(toStripe.used).toEqual([STRIPE]);
    expect(substitute(body, [STRIPE, SHOP], "evil.test").used).toEqual([]);
  });

  it("swaps inside basic authorization", () => {
    const header = `Basic ${Buffer.from(`user:${STRIPE.placeholder}`).toString("base64")}`;
    const { value } = substituteHeader("Authorization", header, [STRIPE], "api.stripe.test");
    expect(Buffer.from(value.slice(6), "base64").toString()).toBe(`user:${STRIPE.value}`);
  });

  it("hides real values that come back in a response", () => {
    expect(scrub(`echo ${STRIPE.value} and ${SHOP.value}`, [STRIPE, SHOP])).toBe(
      `echo ${STRIPE.placeholder} and ${SHOP.placeholder}`,
    );
  });

  it("also hides values that come back escaped or encoded", () => {
    const odd: Injectable = { ...STRIPE, value: "sk/live…é+key=1" };
    const toAscii = (text: string) =>
      JSON.stringify(text).replace(
        /[\u007f-\uffff]/g,
        (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
    const escaped = JSON.stringify({ a: odd.value });
    const ascii = toAscii(odd.value);
    const httpbin = toAscii(Buffer.from(odd.value).toString("latin1"));
    const outputs = [
      escaped,
      ascii,
      httpbin,
      encodeURIComponent(odd.value),
      Buffer.from(odd.value).toString("base64"),
      JSON.stringify(odd.value).replaceAll("/", "\\/"),
    ];
    for (const output of outputs) {
      const text = Buffer.from(output, "utf8").toString("latin1");
      expect(scrub(text, [odd])).toContain(odd.placeholder);
      expect(Buffer.from(scrub(text, [odd]), "latin1").toString()).not.toContain("live");
    }
  });

  it("hides base64, percent, JSON and hex forms of a value", () => {
    const value = "sk_live/ä+b c?~!";
    const odd: Injectable = { ...STRIPE, value };
    const bytes = Buffer.from(value);
    const outputs = [
      bytes.toString("base64"),
      bytes.toString("base64").replace(/=+$/, ""),
      bytes.toString("base64url"),
      bytes.toString("base64url").padEnd(bytes.toString("base64").length, "="),
      encodeURIComponent(value),
      encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
      new URLSearchParams({ q: value }).toString().slice(2),
      [...bytes].map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
      JSON.stringify(value).slice(1, -1),
      bytes.toString("hex"),
      bytes.toString("hex").toUpperCase(),
    ];
    for (const output of outputs) {
      const text = `before ${Buffer.from(output, "utf8").toString("latin1")} after`;
      const scrubbed = scrub(text, [odd]);
      expect(scrubbed, output).toContain(odd.placeholder);
      expect(scrubbed, output).not.toContain(output);
    }
  });

  it("hides a value base64-encoded inside a longer payload at any byte offset", () => {
    for (const prefix of ["", "u:", "user:", "ab"]) {
      for (const alphabet of ["base64", "base64url"] as const) {
        const encoded = Buffer.from(`${prefix}${STRIPE.value}","more":1}`).toString(alphabet);
        const scrubbed = scrub(encoded, [STRIPE]);
        expect(scrubbed, `${alphabet} ${prefix}`).toContain(STRIPE.placeholder);
      }
    }
  });

  it("holds back a chunk tail that could be the start of an encoded value", () => {
    const hex = Buffer.from(STRIPE.value).toString("hex");
    const scrubber = new Scrubber([STRIPE]);
    const first = scrubber.split(`ok ${hex.slice(0, 10)}`);
    expect(first.ready).toBe("ok ");
    const second = scrubber.split(first.pending + hex.slice(10) + " done");
    expect(second.ready).toBe(`${STRIPE.placeholder} done`);
  });

  it("gives only secrets with allowed hosts a placeholder and passes variables through", () => {
    const prepared = plan([
      { name: "STRIPE_KEY", value: "sk_live_abcdef", hosts: ["api.stripe.com"] },
      { name: "PIN", value: "1234", hosts: ["api.stripe.com"] },
      { name: "DATABASE_URL", value: "postgres://x" },
      { name: "LOG_LEVEL", value: "debug", kind: "variable" },
    ]);
    expect(prepared.injectables.map((entry) => entry.name)).toEqual(["STRIPE_KEY"]);
    expect(prepared.injectables[0]!.placeholder).toMatch(/^7key-ph-[0-9a-f]{24}$/);
    expect(prepared.skipped).toEqual(["DATABASE_URL"]);
    expect(prepared.tooShort).toEqual(["PIN"]);
    const env = childEnvironment(
      { PATH: "/bin", SEVENKEY_EMAIL: "me@example.com" },
      prepared,
      "http://127.0.0.1:9",
      { authority: "/tmp/ca.pem", bundle: "/tmp/bundle.pem" },
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      STRIPE_KEY: prepared.injectables[0]!.placeholder,
      LOG_LEVEL: "debug",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NODE_EXTRA_CA_CERTS: "/tmp/ca.pem",
      SSL_CERT_FILE: "/tmp/bundle.pem",
      SEVENKEY_AGENT: "1",
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SEVENKEY_EMAIL).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("sk_live_abcdef");
    expect(JSON.stringify(env)).not.toContain('"1234"');
  });

  it("reads the agent options", () => {
    expect(
      parseAgentArgs(["--project", "Payments API", "--env", "Development", "-y", "--", "claude"]),
    ).toMatchObject({
      project: "Payments API",
      environment: "Development",
      yes: true,
      command: ["claude"],
    });
    expect(() => parseAgentArgs(["--project"])).toThrow("needs a value");
  });
});

describe("agent proxy", () => {
  const upstreamAuthority = createAuthority("test upstream");
  const seen: { host: string; authorization?: string; echo?: string; body: string }[] = [];
  let upstream: https.Server;
  let proxy: RunningProxy;
  let port: number;
  let directory: string;
  let bundle: string;
  const used: string[] = [];

  beforeAll(async () => {
    upstream = https.createServer(
      {
        SNICallback: (host, done) =>
          done(null, tls.createSecureContext(upstreamAuthority.issue(host))),
        ...upstreamAuthority.issue("api.stripe.test"),
      },
      (request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          const echo = String(request.headers["x-echo"] ?? "");
          seen.push({
            host: request.headers.host ?? "",
            authorization: request.headers.authorization,
            echo,
            body,
          });
          const route = (request.url ?? "").split("?")[0];
          if (route === "/gzip") {
            response.writeHead(200, { "content-encoding": "gzip" });
            response.end(zlib.gzipSync(echo));
            return;
          }
          if (route === "/slow") {
            response.write(echo.slice(0, 10));
            setTimeout(() => response.end(echo.slice(10)), 120);
            return;
          }
          if (route === "/reverse-body") {
            response.end([...body].reverse().join(""));
            return;
          }
          if (route === "/compress-other") {
            response.writeHead(200, { "content-encoding": "compress" });
            response.end(echo);
            return;
          }
          response.setHeader("content-type", "application/json");
          response.setHeader("set-cookie", [`a=${echo}`, "b=2"]);
          response.end(JSON.stringify({ echoed: request.headers.authorization, echo, body }));
        });
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
    const authority = createAuthority();
    proxy = await startProxy({
      injectables: [STRIPE, SHOP],
      authority,
      upstreamCa: upstreamAuthority.cert,
      resolve: () => "127.0.0.1",
      onUse: (entry, host) => used.push(`${entry.name}@${host}`),
    });
    directory = mkdtempSync(path.join(tmpdir(), "7key-agent-test-"));
    bundle = path.join(directory, "bundle.pem");
    writeFileSync(bundle, `${authority.cert}\n${upstreamAuthority.cert}`);
    expect(verifies(authority.issue("api.stripe.test").cert, authority.cert)).toBe(true);
  });

  afterAll(async () => {
    await proxy.close();
    upstream.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const raw = (host: string, route: string, ...args: string[]) =>
    run("curl", [
      "-sS",
      "-i",
      "--suppress-connect-headers",
      "--proxy",
      proxy.url,
      "--cacert",
      bundle,
      ...args,
      `https://${host}:${port}${route}`,
    ]).then(({ stdout }) => stdout);
  const curl = (host: string, ...args: string[]) =>
    raw(host, "/v1/charges", ...args).then(
      (text) =>
        JSON.parse(text.slice(text.indexOf("\r\n\r\n") + 4)) as {
          echoed?: string;
          echo?: string;
          body: string;
        },
    );

  it("sends the real secret in headers to an allowed host and never shows it to the caller", async () => {
    const reply = await curl(
      "api.stripe.test",
      "-H",
      `Authorization: Bearer ${STRIPE.placeholder}`,
      "-H",
      `X-Echo: ${STRIPE.placeholder}`,
    );
    const request = seen.at(-1)!;
    expect(request.authorization).toBe(`Bearer ${STRIPE.value}`);
    expect(request.echo).toBe(STRIPE.value);
    expect(reply.echoed).toBe(`Bearer ${STRIPE.placeholder}`);
    expect(reply.echo).toBe(STRIPE.placeholder);
    expect(used).toContain(`STRIPE_KEY@api.stripe.test`);
  });

  it("leaves the URL and body alone, so an echoing API cannot be asked to transform a value", async () => {
    const text = await raw(
      "api.stripe.test",
      `/reverse-body?key=${STRIPE.placeholder}`,
      "-d",
      `key=${STRIPE.placeholder}`,
    );
    expect(seen.at(-1)!.body).toBe(`key=${STRIPE.placeholder}`);
    expect(text).not.toContain([...STRIPE.value].reverse().join(""));
  });

  it("hides values in compressed, slow and cookie responses", async () => {
    const header = ["-H", `X-Echo: ${STRIPE.placeholder}`];
    for (const route of ["/gzip", "/slow", "/v1/charges"]) {
      const text = await raw("api.stripe.test", route, "--compressed", ...header);
      expect(text).not.toContain(STRIPE.value);
      expect(text).toContain(STRIPE.placeholder);
    }
    const refused = await raw("api.stripe.test", "/compress-other", ...header);
    expect(refused).toMatch(/^HTTP\/1\.1 502/);
    expect(refused).not.toContain(STRIPE.value);
  });

  it("tunnels other hosts untouched, so a placeholder sent elsewhere stays a placeholder", async () => {
    await curl("evil.test", "-H", `Authorization: Bearer ${STRIPE.placeholder}`);
    const request = seen.at(-1)!;
    expect(request.host).toBe(`evil.test:${port}`);
    expect(request.authorization).toBe(`Bearer ${STRIPE.placeholder}`);
    expect(used).not.toContain(`STRIPE_KEY@evil.test`);
  });

  it("matches wildcard hosts", async () => {
    await curl("store.myshop.test", "-H", `X-Shopify-Access-Token: ${SHOP.placeholder}`);
    expect(used).toContain(`SHOP_TOKEN@store.myshop.test`);
  });

  it("refuses clients without the session's proxy credentials", async () => {
    const anonymous = proxy.url.replace(/\/\/[^@]+@/, "//");
    const result = await run("curl", [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--proxy",
      anonymous,
      "--cacert",
      bundle,
      `https://api.stripe.test:${port}/`,
    ]).catch((error: { stdout: string }) => error);
    expect(result.stdout).toMatch(/407|000/);
  });
});
