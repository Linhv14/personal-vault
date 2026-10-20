export type DeviceKind = "browser" | "cli" | "ci" | "unknown";

export const CLI_LABEL = "7key CLI";
export const CI_LABEL = "GitHub Action";

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Macintosh|Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

const match = (table: [RegExp, string][], ua: string) =>
  table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

export function deviceLabel(userAgent: string | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (/7key-action|github-actions/i.test(ua)) return CI_LABEL;
  if (/7key-cli/i.test(ua) || /^(node|undici)\b/i.test(ua)) return CLI_LABEL;
  const browser = match(BROWSERS, ua);
  const system = match(SYSTEMS, ua);
  if (browser && system) return `${browser} · ${system}`;
  return browser ?? system ?? "";
}

export function deviceKind(label: string): DeviceKind {
  if (label === CLI_LABEL) return "cli";
  if (label === CI_LABEL) return "ci";
  return label ? "browser" : "unknown";
}
