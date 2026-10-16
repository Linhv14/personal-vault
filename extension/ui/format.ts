export function formatDateTime(epochSeconds: number, locale: string): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
