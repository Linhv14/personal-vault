const TRUNK_PREFIX: Record<string, string> = { "84": "0" };

export function nationalPhone(phone: string): string {
  const match = /^\s*\+(\d{1,3})[\s-]*(.+)$/.exec(phone);
  if (!match?.[1] || !match[2]) {
    return phone.trim();
  }
  return `${TRUNK_PREFIX[match[1]] ?? ""}${match[2]}`;
}
