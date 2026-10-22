export function parseSiteUrl(input: string): URL | null {
  try {
    return new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return null;
  }
}

export function siteHostname(input: string): string | null {
  return parseSiteUrl(input)?.hostname.replace(/^www\./, "") ?? null;
}

const SHARED_HOSTING_SUFFIXES = new Set([
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "appspot.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "onrender.com",
  "fly.dev",
  "glitch.me",
  "ngrok.io",
  "ngrok-free.app",
  "repl.co",
  "surge.sh",
]);

const TWO_PART_TLD_SECONDS = new Set(["com", "net", "org", "edu", "gov", "co", "ac"]);

export function registrableDomain(rawUrl: string): string | null {
  const hostname = parseSiteUrl(rawUrl)?.hostname;
  if (hostname === undefined) {
    return null;
  }
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    return hostname;
  }
  const labels = hostname.replace(/^www\./, "").split(".");
  if (labels.length <= 2) {
    return labels.join(".");
  }
  if (SHARED_HOSTING_SUFFIXES.has(labels.slice(-2).join("."))) {
    return labels.slice(-3).join(".");
  }
  const secondLast = labels.at(-2);
  const last = labels.at(-1);
  if (last && secondLast && last.length === 2 && TWO_PART_TLD_SECONDS.has(secondLast)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

const SIGN_IN_PREFIXES = new Set([
  "accounts",
  "account",
  "login",
  "signin",
  "auth",
  "sso",
  "id",
  "secure",
]);

export function siteOf(rawUrl: string): string | null {
  const host = siteHostname(rawUrl);
  const domain = registrableDomain(rawUrl);
  if (!host || !domain || host === domain || !host.endsWith(`.${domain}`)) {
    return host ?? domain;
  }
  const [first, ...rest] = host.split(".");
  return first && SIGN_IN_PREFIXES.has(first) && rest.join(".") === domain ? domain : host;
}
