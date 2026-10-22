import { isPlainObject } from "#core/json.js";
import type { Env } from "#worker/types.js";
import { testIdpEnabled } from "./env.js";
import { testIdpFetcher } from "./test-idp.js";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

let override: Fetcher | null = null;
const NETWORK: Fetcher = (url, init) => fetch(url, init);

export function setSsoFetcher(fetcher: Fetcher | null): void {
  override = fetcher;
}

export function ssoFetcher(env: Env, requestUrl: string): Fetcher {
  if (override) {
    return override;
  }
  return testIdpEnabled(env, requestUrl) ? testIdpFetcher(env, NETWORK) : NETWORK;
}

async function readLimited(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    return null;
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {},
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  try {
    const text = await readLimited(response);
    if (text === null) {
      return null;
    }
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}
