import { toBase64 } from "#core/bytes.js";
import { isPlainObject } from "#core/json.js";
import { platform } from "./platform.js";

const CACHE_KEY = "logoCache";
const FOUND_SECONDS = 7 * 86_400;
const MISSING_SECONDS = 86_400;
const MAX_CACHED = 400;

interface CachedLogo {
  url: string | null;
  at: number;
}

let entries: Promise<Map<string, CachedLogo>> | null = null;

function isCachedLogo(value: unknown): value is CachedLogo {
  return (
    isPlainObject(value) &&
    typeof value.at === "number" &&
    (value.url === null || (typeof value.url === "string" && value.url.startsWith("data:image/")))
  );
}

function load(): Promise<Map<string, CachedLogo>> {
  entries ??= platform()
    .session.get(CACHE_KEY)
    .then((stored) => {
      const value = stored[CACHE_KEY];
      return new Map(
        (isPlainObject(value) ? Object.entries(value) : []).filter(
          (entry): entry is [string, CachedLogo] => isCachedLogo(entry[1]),
        ),
      );
    })
    .catch(() => new Map<string, CachedLogo>());
  return entries;
}

export async function cachedLogo(
  domain: string,
  now: number,
): Promise<{ url: string | null } | null> {
  const entry = (await load()).get(domain);
  if (!entry || now - entry.at >= (entry.url ? FOUND_SECONDS : MISSING_SECONDS)) {
    return null;
  }
  return { url: entry.url };
}

export async function rememberLogo(domain: string, url: string | null, now: number): Promise<void> {
  const cache = await load();
  cache.delete(domain);
  cache.set(domain, { url, at: now });
  while (cache.size > MAX_CACHED) {
    cache.delete(cache.keys().next().value!);
  }
  await platform()
    .session.set({ [CACHE_KEY]: Object.fromEntries(cache) })
    .catch(() => {});
}

export async function logoDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}
