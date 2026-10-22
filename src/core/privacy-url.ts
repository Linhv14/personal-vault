export function privacyUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname ? url.href : undefined;
  } catch {
    return undefined;
  }
}
