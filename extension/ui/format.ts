export function formatDateTime(epochSeconds: number, locale: string): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function formatRelative(epochSeconds: number, locale: string, now = Date.now()): string {
  const delta = epochSeconds - Math.floor(now / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of RELATIVE_STEPS) {
    if (Math.abs(delta) >= seconds) return format.format(Math.round(delta / seconds), unit);
  }
  return format.format(0, "second");
}
