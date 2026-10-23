import { signal } from "@preact/signals";
import * as api from "#ext/lib/api.js";
import { cachedLogo, logoDataUrl, rememberLogo } from "#ext/lib/logo-cache.js";
import { parseSiteUrl } from "#core/site.js";

const MAX_PARALLEL = 6;

export const showLogos = signal(true);

const loaded = new Map<string, Promise<string | null>>();
const resolved = new Map<string, string | null>();
const waiting: (() => void)[] = [];
let running = 0;

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function load(domain: string): Promise<string | null> {
  const now = Date.now() / 1000;
  const hit = await cachedLogo(domain, now);
  if (hit) {
    return hit.url;
  }
  const answer = await slot(() => api.fetchLogo(domain));
  if (answer === null) {
    return null;
  }
  const url = answer === "missing" ? null : await logoDataUrl(answer);
  await rememberLogo(domain, url, now);
  return url;
}

export function logoFor(domain: string): Promise<string | null> {
  let pending = loaded.get(domain);
  if (!pending) {
    pending = load(domain).then((url) => {
      resolved.set(domain, url);
      return url;
    });
    loaded.set(domain, pending);
  }
  return pending;
}

export function knownLogo(domain: string): string | null | undefined {
  return resolved.get(domain);
}

export function logoDomainOf(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  const host = parseSiteUrl(url)?.hostname.toLowerCase();
  return host !== undefined &&
    /^[a-z0-9.-]+\.[a-z][a-z0-9-]*$/.test(host) &&
    !/^\d+(\.\d+){3}$/.test(host)
    ? host.replace(/^www\./, "")
    : null;
}
