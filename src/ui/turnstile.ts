export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
const SLOT_SELECTOR = "[data-turnstile]";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_unavailable"));
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("turnstile_unavailable"));
    };
    document.head.append(script);
  });
  return loading;
}

export function turnstileSlot(): HTMLElement {
  const slots = [...document.querySelectorAll<HTMLElement>(SLOT_SELECTOR)];
  const visible = slots.find((slot) => !slot.closest("[hidden]"));
  if (visible) {
    return visible;
  }
  const fallback = document.createElement("div");
  fallback.dataset.turnstile = "";
  fallback.className = "turnstile-slot";
  document.body.append(fallback);
  return fallback;
}

export async function turnstileToken(
  siteKey: string,
  slot: HTMLElement = turnstileSlot(),
): Promise<string> {
  const api = await loadTurnstile();
  const host = document.createElement("div");
  slot.append(host);
  let widgetId: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      widgetId = api.render(host, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: (token: string) => resolve(token),
        "error-callback": () => {
          reject(new Error("turnstile_failed"));
          return true;
        },
        "timeout-callback": () => reject(new Error("turnstile_timeout")),
      });
    });
  } finally {
    if (widgetId !== undefined) {
      api.remove(widgetId);
    }
    host.remove();
  }
}
