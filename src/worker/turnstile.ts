import type { MiddlewareHandler } from "hono";
import { apiError } from "./errors.js";
import { logError, logInfo } from "./log.js";
import { clientIp } from "./request.js";
import type { AppBindings, Env } from "./types.js";

export const TURNSTILE_HEADER = "X-Turnstile-Token";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
const SITEVERIFY_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 2048;
const DUMMY_SECRET = /^[123]x0{31}AA$/;

interface SiteverifyOutcome {
  success?: boolean;
  hostname?: string;
  "error-codes"?: string[];
}

export function turnstileSiteKey(env: Env): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  return siteKey && env.TURNSTILE_SECRET?.trim() ? siteKey : null;
}

function allowedHostnames(env: Env, requestHost: string): Set<string> {
  const aliases = (env.ALIAS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try {
        return [new URL(origin).hostname];
      } catch {
        return [];
      }
    });
  return new Set([requestHost, ...aliases].map((host) => host.toLowerCase()));
}

export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip: string,
  requestHost: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET?.trim();
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH) return false;

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);

  let outcome: SiteverifyOutcome;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`siteverify answered ${response.status}`);
    outcome = (await response.json()) as SiteverifyOutcome;
  } catch (error) {
    logError("turnstile_unreachable", error);
    return false;
  }

  if (outcome.success !== true) {
    logInfo("turnstile_rejected", { codes: outcome["error-codes"] ?? [] });
    return false;
  }
  if (!outcome.hostname || DUMMY_SECRET.test(secret)) return true;
  if (allowedHostnames(env, requestHost).has(outcome.hostname.toLowerCase())) return true;
  logInfo("turnstile_hostname_mismatch", { hostname: outcome.hostname });
  return false;
}

export const requireHuman: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!turnstileSiteKey(c.env)) return next();
  const passed = await verifyTurnstile(
    c.env,
    c.req.header(TURNSTILE_HEADER),
    clientIp(c),
    new URL(c.req.url).hostname,
  );
  if (!passed) return c.json(apiError("auth.bot_check_failed"), 403);
  await next();
};

const FRAME_ANCESTORS = "'self' chrome-extension: moz-extension:";

export function turnstileFramePage(siteKey: string, nonce: string): string {
  const key = JSON.stringify(siteKey).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>7key</title>
<style>html,body{margin:0;background:transparent;overflow:hidden}</style>
<script nonce="${nonce}">
(() => {
  const target = new URLSearchParams(location.search).get("origin") || "";
  const allowed =
    target === location.origin || /^(chrome|moz)-extension:\\/\\/[a-z0-9-]+$/.test(target);
  if (!allowed || window.parent === window) return;
  const post = (message) =>
    window.parent.postMessage(Object.assign({ source: "7key-turnstile" }, message), target);
  window.onTurnstileReady = () =>
    window.turnstile.render("#widget", {
      sitekey: ${key},
      appearance: "interaction-only",
      callback: (token) => post({ token }),
      "before-interactive-callback": () => post({ interactive: true }),
      "error-callback": () => {
        post({ error: true });
        return true;
      },
      "timeout-callback": () => post({ error: true }),
    });
})();
</script>
<script nonce="${nonce}" src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=onTurnstileReady" async defer></script>
</head>
<body><div id="widget"></div></body>
</html>
`;
}

export function turnstileFrameHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${FRAME_ANCESTORS}`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}
