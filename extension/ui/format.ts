export function formatDateTime(epochSeconds: number, locale: string): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(locale, {
    day: "numeric",
    month: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}
