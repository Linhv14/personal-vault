import { turnstileSlot } from "../../src/ui/turnstile.js";

const SILENT_TIMEOUT_MS = 30_000;

interface FrameMessage {
  source?: unknown;
  token?: unknown;
  interactive?: unknown;
  error?: unknown;
}

export function turnstileFrameUrl(apiUrl: string, parentOrigin: string): string {
  const url = new URL("/turnstile", apiUrl);
  url.searchParams.set("origin", parentOrigin);
  return url.href;
}

export function frameTurnstileToken(
  apiUrl: string,
  slot: HTMLElement = turnstileSlot(),
): Promise<string> {
  const origin = new URL(apiUrl).origin;
  const frame = document.createElement("iframe");
  frame.className = "turnstile-frame";
  frame.title = "Cloudflare Turnstile";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
  frame.src = turnstileFrameUrl(apiUrl, location.origin);

  return new Promise<string>((resolve, reject) => {
    const finish = (token: string | null) => {
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      frame.remove();
      if (token) {
        resolve(token);
      } else {
        reject(new Error("turnstile_failed"));
      }
    };
    const timer = setTimeout(() => finish(null), SILENT_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.contentWindow) {
        return;
      }
      const data = (event.data ?? {}) as FrameMessage;
      if (data.source !== "7key-turnstile") {
        return;
      }
      if (data.interactive === true) {
        clearTimeout(timer);
        frame.classList.add("interactive");
      } else if (typeof data.token === "string" && data.token) {
        finish(data.token);
      } else if (data.error === true) {
        finish(null);
      }
    };
    addEventListener("message", onMessage);
    slot.append(frame);
  });
}
