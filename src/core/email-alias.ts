const PLUS_ADDRESSING = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "fastmail.com",
  "fastmail.fm",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
]);

export function aliasTag(registrableDomain: string): string {
  const label = registrableDomain.toLowerCase().split(".")[0] ?? "";
  return label.replace(/[^a-z0-9-]/g, "").slice(0, 32);
}

export function supportsAliases(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain !== undefined && PLUS_ADDRESSING.has(domain);
}

export function emailAlias(email: string, tag: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || !tag || !supportsAliases(email)) {
    return null;
  }
  const local = email.slice(0, at).split("+")[0];
  return `${local}+${tag}@${email.slice(at + 1).toLowerCase()}`;
}

export function emailAliases(emails: readonly string[], tag: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    const alias = emailAlias(email.trim(), tag);
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      out.push(alias);
    }
  }
  return out;
}
