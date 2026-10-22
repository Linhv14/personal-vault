import { registrableDomain } from "../../../src/core/site.js";
import type { ItemDraft } from "../vault.js";
import { customFields, firstTotp, type ImportSource } from "./source.js";

const COLUMNS = {
  title: ["title", "name", "item name", "account"],
  url: ["url", "website", "web site", "login_uri", "login url", "uri"],
  username: ["username", "user name", "login_username", "login", "email", "user"],
  password: ["password", "login_password", "pass"],
  totp: ["otpauth", "totp", "login_totp", "one-time password", "otp", "2fa"],
  note: ["notes", "note", "notesplain", "comments", "extra"],
} as const;

type Column = keyof typeof COLUMNS;

function columnOf(header: string[], column: Column): string | undefined {
  return COLUMNS[column].find((name) => header.includes(name));
}

export function isGenericCsv(header: string[]): boolean {
  return (
    columnOf(header, "password") !== undefined &&
    (columnOf(header, "title") !== undefined || columnOf(header, "url") !== undefined)
  );
}

export function genericCsv(header: string[], records: Record<string, string>[]): ImportSource {
  const read = (row: Record<string, string>, column: Column) => {
    const name = columnOf(header, column);
    return (name ? row[name] : "")?.trim() ?? "";
  };
  const drafts = records.flatMap((row): ItemDraft[] => {
    const url = read(row, "url").split(/[\s,]+/)[0] || undefined;
    const username = read(row, "username") || undefined;
    const password = row[columnOf(header, "password") ?? ""] || undefined;
    const title = read(row, "title") || (url && registrableDomain(url)) || username || "";
    if (!title && !password) {
      return [];
    }
    const { totp, unreadable } = firstTotp([read(row, "totp")], title);
    return [
      {
        title: title || "Login",
        url,
        username,
        password,
        totp,
        note: read(row, "note") || undefined,
        fields: customFields(unreadable.map((uri) => ({ label: "2FA", value: uri, hidden: true }))),
      },
    ];
  });
  return { format: "csv", drafts, skipped: {} };
}
