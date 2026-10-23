import { signal } from "@preact/signals";
import { toBase64 } from "#core/bytes.js";
import { isPlainObject } from "#core/json.js";
import * as api from "../lib/api.js";
import { platform } from "../lib/platform.js";
import { parseSiteUrl } from "#core/site.js";

const MAX_PARALLEL = 6;
const CACHE_KEY = "logoCache";
const FOUND_SECONDS = 7 * 86_400;
const MISSING_SECONDS = 86_400;
const MAX_CACHED = 400;

interface CachedLogo {
  url: string | null;
  at: number;
}

let cache: Promise<Map<string, CachedLogo>> | null = null;

function fresh(entry: CachedLogo, now: number): boolean {
  return now - entry.at < (entry.url ? FOUND_SECONDS : MISSING_SECONDS);
}

function cached(): Promise<Map<string, CachedLogo>> {
  cache ??= platform()
    .session.get(CACHE_KEY)
    .then((stored) => {
      const value = stored[CACHE_KEY];
      const entries = isPlainObject(value) ? Object.entries(value) : [];
      return new Map(
        entries.filter(
          (entry): entry is [string, CachedLogo] =>
            isPlainObject(entry[1]) &&
            typeof entry[1].at === "number" &&
            (entry[1].url === null ||
              (typeof entry[1].url === "string" && entry[1].url.startsWith("data:image/"))),
        ),
      );
    })
    .catch(() => new Map<string, CachedLogo>());
  return cache;
}

async function remember(domain: string, url: string | null): Promise<void> {
  const entries = await cached();
  entries.delete(domain);
  entries.set(domain, { url, at: Date.now() / 1000 });
  while (entries.size > MAX_CACHED) {
    entries.delete(entries.keys().next().value!);
  }
  await platform()
    .session.set({ [CACHE_KEY]: Object.fromEntries(entries) })
    .catch(() => {});
}

async function dataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

async function load(domain: string): Promise<string | null> {
  const hit = (await cached()).get(domain);
  if (hit && fresh(hit, Date.now() / 1000)) {
    return hit.url;
  }
  const answer = await slot(() => api.fetchLogo(domain));
  if (answer === null) {
    return null;
  }
  const url = answer === "missing" ? null : await dataUrl(answer);
  await remember(domain, url);
  return url;
}

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
