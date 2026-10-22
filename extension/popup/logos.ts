import { signal } from "@preact/signals";
import * as api from "../lib/api.js";

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

export function logoFor(domain: string): Promise<string | null> {
  let pending = loaded.get(domain);
  if (!pending) {
    pending = slot(() => api.fetchLogo(domain)).then((blob) => {
      const url = blob ? URL.createObjectURL(blob) : null;
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
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
    return /^[a-z0-9.-]+\.[a-z][a-z0-9-]*$/.test(host) && !/^\d+(\.\d+){3}$/.test(host)
      ? host.replace(/^www\./, "")
      : null;
  } catch {
    return null;
  }
}
