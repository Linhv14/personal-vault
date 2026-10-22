import { parseSiteUrl } from "./site.js";

export type LookalikeReason = "confusable" | "embedded" | "typo";

export interface LookalikeMatch {
  kind: "lookalike";
  target: string;
  reason: LookalikeReason;
}

const MIN_LABEL = 4;
const LONG_LABEL = 10;

const TWO_PART_SECOND = new Set(["com", "net", "org", "edu", "gov", "co", "ac"]);

const SHARED_HOSTING = new Set([
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

const SWAPPABLE_TLDS = new Set([
  "com",
  "co",
  "cm",
  "net",
  "org",
  "io",
  "app",
  "info",
  "biz",
  "xyz",
  "top",
  "online",
  "site",
  "live",
]);

const GENERIC_LABELS = new Set([
  "mail",
  "email",
  "login",
  "logon",
  "signin",
  "signup",
  "account",
  "accounts",
  "secure",
  "security",
  "verify",
  "auth",
  "app",
  "apps",
  "web",
  "webmail",
  "shop",
  "store",
  "help",
  "support",
  "docs",
  "blog",
  "news",
  "home",
  "cloud",
  "portal",
  "admin",
  "online",
  "service",
  "services",
  "update",
  "info",
  "mobile",
  "static",
  "media",
  "status",
  "forum",
  "community",
  "wiki",
  "drive",
  "live",
  "office",
  "team",
  "chat",
  "pay",
  "payment",
  "payments",
  "bank",
  "wallet",
  "test",
  "demo",
  "beta",
  "stage",
  "staging",
  "local",
  "localhost",
  "example",
]);

const CONFUSABLES: Record<string, string> = {
  а: "a",
  ɑ: "a",
  α: "a",
  в: "b",
  Ь: "b",
  ь: "b",
  с: "c",
  ϲ: "c",
  ԁ: "d",
  е: "e",
  ё: "e",
  ε: "e",
  һ: "h",
  н: "h",
  і: "i",
  ї: "i",
  ι: "i",
  ı: "i",
  ј: "j",
  к: "k",
  κ: "k",
  ӏ: "l",
  ł: "l",
  м: "m",
  п: "n",
  η: "n",
  о: "o",
  ο: "o",
  σ: "o",
  ө: "o",
  р: "p",
  ρ: "p",
  ԛ: "q",
  ѕ: "s",
  т: "t",
  τ: "t",
  υ: "u",
  ս: "u",
  ν: "v",
  ѵ: "v",
  ԝ: "w",
  ѡ: "w",
  х: "x",
  χ: "x",
  у: "y",
  ү: "y",
  γ: "y",
  ʐ: "z",
  "0": "o",
  "1": "l",
  "|": "l",
};

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta: number, points: number, first: boolean): number {
  let scaled = first ? Math.floor(delta / DAMP) : delta >> 1;
  scaled += Math.floor(scaled / points);
  let k = 0;
  while (scaled > ((BASE - T_MIN) * T_MAX) >> 1) {
    scaled = Math.floor(scaled / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

function digitOf(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 22;
  }
  if (code >= 65 && code <= 90) {
    return code - 65;
  }
  if (code >= 97 && code <= 122) {
    return code - 97;
  }
  return BASE;
}

export function decodePunycode(input: string): string | null {
  const output: number[] = [];
  const split = input.lastIndexOf("-");
  for (let index = 0; index < Math.max(split, 0); index++) {
    const code = input.charCodeAt(index);
    if (code >= 0x80) {
      return null;
    }
    output.push(code);
  }
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let index = split > 0 ? split + 1 : 0; index < input.length;) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) {
        return null;
      }
      const digit = digitOf(input.charCodeAt(index++));
      if (digit >= BASE) {
        return null;
      }
      i += digit * w;
      const threshold = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < threshold) {
        break;
      }
      w *= BASE - threshold;
      if (!Number.isSafeInteger(i) || !Number.isSafeInteger(w)) {
        return null;
      }
    }
    const length = output.length + 1;
    bias = adapt(i - oldi, length, oldi === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) {
      return null;
    }
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

export function unicodeHost(host: string): string {
  return host
    .split(".")
    .map((label) => (label.startsWith("xn--") ? (decodePunycode(label.slice(4)) ?? label) : label))
    .join(".");
}

export function skeleton(text: string): string {
  const folded = text.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return [...folded]
    .map((char) => CONFUSABLES[char] ?? char)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

function cleanHost(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  if (!host) {
    return null;
  }
  if (host.includes("://") || host.includes("/")) {
    const url = parseSiteUrl(host);
    if (!url) {
      return null;
    }
    host = url.hostname;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) {
    return null;
  }
  return host;
}

interface Domain {
  host: string;
  registrable: string;
  label: string;
  suffix: string;
  subdomain: string[];
}

function parseDomain(raw: string): Domain | null {
  const host = cleanHost(raw);
  if (!host) {
    return null;
  }
  const labels = host.split(".");
  let suffixLength = 1;
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 3 && SHARED_HOSTING.has(lastTwo)) {
    suffixLength = 2;
  } else if (
    labels.length >= 3 &&
    labels.at(-1)!.length === 2 &&
    TWO_PART_SECOND.has(labels.at(-2)!)
  ) {
    suffixLength = 2;
  }
  if (labels.length <= suffixLength) {
    return null;
  }
  const registrableLabels = labels.slice(-(suffixLength + 1));
  return {
    host,
    registrable: registrableLabels.join("."),
    label: registrableLabels[0]!,
    suffix: registrableLabels.slice(1).join("."),
    subdomain: labels.slice(0, -(suffixLength + 1)),
  };
}

export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

function tldsComparable(page: Domain, target: Domain): boolean {
  if (page.suffix === target.suffix) {
    return true;
  }
  return SWAPPABLE_TLDS.has(page.suffix) && SWAPPABLE_TLDS.has(target.suffix);
}

function distinctive(label: string): boolean {
  return label.length >= MIN_LABEL && !GENERIC_LABELS.has(label);
}

function confusable(page: Domain, target: Domain): boolean {
  const unicode = parseDomain(unicodeHost(page.host));
  if (!unicode || !distinctive(target.label) || unicode.label === target.label) {
    return false;
  }
  if (!tldsComparable(unicode, target)) {
    return false;
  }
  return skeleton(unicode.label) === skeleton(target.label);
}

function embedded(page: Domain, target: Domain): boolean {
  if (!distinctive(target.label) || page.label === target.label) {
    return false;
  }
  const wanted = skeleton(target.label);
  const tokens = [...page.subdomain, page.label]
    .map((label) => unicodeHost(label))
    .flatMap((label) => label.split(/[-_]/));
  return tokens.some((token) => token === target.label || skeleton(token) === wanted);
}

function typo(page: Domain, target: Domain): boolean {
  if (!distinctive(target.label) || !tldsComparable(page, target)) {
    return false;
  }
  if (page.label === target.label) {
    return page.suffix !== target.suffix;
  }
  const limit = target.label.length >= LONG_LABEL ? 2 : 1;
  return damerauLevenshtein(page.label, target.label) <= limit;
}

const CHECKS: readonly (readonly [LookalikeReason, (page: Domain, target: Domain) => boolean])[] = [
  ["confusable", confusable],
  ["embedded", embedded],
  ["typo", typo],
];

export function findLookalike(pageHost: string, savedDomains: string[]): LookalikeMatch | null {
  const page = parseDomain(pageHost);
  if (!page) {
    return null;
  }
  const targets = new Map<string, Domain>();
  for (const raw of savedDomains) {
    const domain = parseDomain(raw);
    if (domain) {
      targets.set(domain.registrable, domain);
    }
  }
  if (targets.has(page.registrable)) {
    return null;
  }
  const sorted = [...targets.values()].sort((a, b) => a.registrable.localeCompare(b.registrable));
  for (const [reason, check] of CHECKS) {
    const hit = sorted.find((target) => check(page, target));
    if (hit) {
      return { kind: "lookalike", target: hit.registrable, reason };
    }
  }
  return null;
}
