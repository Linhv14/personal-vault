const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const LOGO_MAX_BYTES = 64 * 1024;
export const LOGO_CACHE_SECONDS = 7 * 86_400;

export function logoDomain(value: string | undefined): string | null {
  const domain = (value ?? "").trim().toLowerCase().replace(/\.$/, "");
  return HOSTNAME.test(domain) ? domain : null;
}

export function logoSources(domain: string): string[] {
  const encoded = encodeURIComponent(domain);
  return [
    `https://icons.duckduckgo.com/ip3/${encoded}.ico`,
    `https://www.google.com/s2/favicons?domain=${encoded}&sz=64`,
  ];
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

async function fetchImage(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const response = await fetch(url, { redirect: "follow" });
  const type = response.headers.get("Content-Type") ?? "";
  const declared = Number(response.headers.get("Content-Length") ?? 0);
  if (!response.ok || !type.startsWith("image/") || !response.body || declared > LOGO_MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const body = await readCapped(response.body, LOGO_MAX_BYTES);
  if (!body || body.byteLength === 0) return null;
  return { body, type };
}

export async function fetchLogo(domain: string): Promise<Response | null> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const key = new Request(`https://logo-cache.invalid/${domain}`);
  const cached = await cache.match(key);
  if (cached) return cached;

  for (const source of logoSources(domain)) {
    const image = await fetchImage(source).catch(() => null);
    if (!image) continue;
    const response = new Response(image.body, {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": `public, max-age=${LOGO_CACHE_SECONDS}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
    await cache.put(key, response.clone());
    return response;
  }
  return null;
}
