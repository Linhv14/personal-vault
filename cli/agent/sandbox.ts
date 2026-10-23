import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createAuthority } from "./certs.js";
import type { Plan } from "./plan.js";
import { startProxy } from "./proxy.js";
import type { Injectable } from "./substitute.js";

const CA_VARIABLES = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
];

export function childEnvironment(
  base: NodeJS.ProcessEnv,
  selected: Plan,
  proxyUrl: string,
  files: { authority: string; bundle: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of Object.keys(env)) {
    if (name.startsWith("SEVENKEY_")) {
      delete env[name];
    }
  }
  for (const { name, value } of selected.variables) {
    env[name] = value;
  }
  for (const { name, placeholder } of selected.injectables) {
    env[name] = placeholder;
  }
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
    env[name] = proxyUrl;
  }
  const noProxy = ["localhost", "127.0.0.1", "::1"];
  env.NO_PROXY = env.no_proxy = noProxy.join(",");
  env.NODE_USE_ENV_PROXY = "1";
  env.NODE_EXTRA_CA_CERTS = files.authority;
  for (const name of CA_VARIABLES) {
    env[name] = files.bundle;
  }
  env.SEVENKEY_AGENT = "1";
  return env;
}

export interface Sandbox {
  env(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  close(): Promise<void>;
}

export async function openSandbox(
  prepared: Plan,
  options: {
    onUse: (entry: Injectable, host: string) => void;
    upstreamCa?: string;
    resolve?: (host: string) => string;
  },
): Promise<Sandbox> {
  const authority = createAuthority();
  const directory = mkdtempSync(path.join(tmpdir(), "7key-agent-"));
  const files = {
    authority: path.join(directory, "ca.pem"),
    bundle: path.join(directory, "bundle.pem"),
  };
  try {
    writeFileSync(files.authority, authority.cert, { mode: 0o600 });
    writeFileSync(files.bundle, [...tls.rootCertificates, authority.cert].join("\n"), {
      mode: 0o600,
    });
    const proxy = await startProxy({
      injectables: prepared.injectables,
      authority,
      upstreamCa: options.upstreamCa,
      resolve: options.resolve,
      onUse: options.onUse,
    });
    return {
      env: (base) => childEnvironment(base, prepared, proxy.url, files),
      close: async () => {
        await proxy.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
