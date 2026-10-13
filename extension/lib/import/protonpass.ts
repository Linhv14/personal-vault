import { parseTotpInput } from "../../../src/core/totp.js";
import { duplicateKey, registrableDomain, type ItemDraft, type VaultItem } from "../vault.js";
import type { StoredPasskey } from "../passkey/authenticator.js";
import { csvRecords } from "./csv.js";
import { readProtonPasskey, type ProtonPasskeyFields } from "./proton-passkey.js";
import { readZip, ZipError } from "./zip.js";

export type ImportErrorCode = "encrypted" | "unrecognized" | "damaged";

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = "ImportError";
  }
}

export type SkipReason =
  "duplicate" | "trashed" | "alias" | "card" | "identity" | "other" | "passkey";

export interface ImportPlan {
  items: ItemDraft[];
  passkeysForExisting: VaultItem[];
  skipped: Partial<Record<SkipReason, number>>;
}

interface ExtraField {
  name: string;
  value: string;
  totp: boolean;
}

interface ProtonEntry {
  type: string;
  name: string;
  urls: string[];
  email: string;
  username: string;
  password: string;
  note: string;
  totp: string;
  ssid: string;
  extraFields: ExtraField[];
  createTime?: number;
  trashed: boolean;
  passkeyFields: ProtonPasskeyFields[];
  passkeys: StoredPasskey[];
  unreadablePasskeys: number;
}

const TRASHED = 2;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

type JsonObject = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function fromJsonItem(raw: unknown): ProtonEntry {
  const item = object(raw);
  const data = object(item.data);
  const content = object(data.content);
  const metadata = object(data.metadata);
  const urls = Array.isArray(content.urls)
    ? content.urls.map(text)
    : list(content.autofillUrls).map((entry) => text(object(entry).url));
  const extraFields = list(data.extraFields).map((raw): ExtraField => {
    const field = object(raw);
    const value = object(field.data);
    return {
      name: text(field.fieldName),
      value: text(value.content ?? value.totpUri ?? value.timestamp),
      totp: field.type === "totp",
    };
  });
  return {
    type: text(data.type),
    name: text(metadata.name),
    urls: urls.filter(Boolean),
    email: text(content.itemEmail),
    username: text(content.itemUsername),
    password: text(content.password),
    note: text(metadata.note),
    totp: text(content.totpUri),
    ssid: text(content.ssid),
    extraFields,
    createTime: typeof item.createTime === "number" ? item.createTime : undefined,
    trashed: item.state === TRASHED,
    passkeyFields: list(content.passkeys).flatMap((raw): ProtonPasskeyFields[] => {
      const passkey = object(raw);
      const fields = text(passkey.content);
      return fields
        ? [
            {
              content: fields,
              userName: text(passkey.userName),
              userDisplayName: text(passkey.userDisplayName),
              createTime: typeof passkey.createTime === "number" ? passkey.createTime : undefined,
            },
          ]
        : [];
    }),
    passkeys: [],
    unreadablePasskeys: 0,
  };
}

function fromJson(json: string): ProtonEntry[] {
  let parsed: JsonObject;
  try {
    parsed = object(JSON.parse(json));
  } catch {
    throw new ImportError("damaged");
  }
  if (parsed.encrypted === true) throw new ImportError("encrypted");
  if (typeof parsed.vaults !== "object" || parsed.vaults === null) {
    throw new ImportError("unrecognized");
  }
  return Object.values(object(parsed.vaults)).flatMap((vault) =>
    list(object(vault).items).map(fromJsonItem),
  );
}

function fromCsv(csv: string): ProtonEntry[] {
  const records = csvRecords(csv);
  const [first] = records;
  if (first && !("type" in first && "name" in first)) {
    throw new ImportError("unrecognized");
  }
  return records.map((row) => ({
    type: row.type ?? "",
    name: row.name ?? "",
    urls: (row.url ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
    email: row.email ?? "",
    username: row.username ?? "",
    password: row.password ?? "",
    note: row.note ?? "",
    totp: row.totp ?? "",
    ssid: "",
    extraFields: [],
    createTime: Number(row.createTime) || undefined,
    trashed: false,
    passkeyFields: [],
    passkeys: [],
    unreadablePasskeys: 0,
  }));
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

async function withPasskeys(entries: ProtonEntry[]): Promise<ProtonEntry[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const read = await Promise.all(entry.passkeyFields.map(readProtonPasskey));
      const passkeys = read.filter((passkey): passkey is StoredPasskey => passkey !== null);
      return { ...entry, passkeys, unreadablePasskeys: read.length - passkeys.length };
    }),
  );
}

export async function readProtonPassExport(bytes: Uint8Array): Promise<ProtonEntry[]> {
  return withPasskeys(await readEntries(bytes));
}

async function readEntries(bytes: Uint8Array): Promise<ProtonEntry[]> {
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    let entries;
    try {
      entries = readZip(bytes);
    } catch (error) {
      if (error instanceof ZipError) throw new ImportError("damaged");
      throw error;
    }
    if (entries.some((entry) => entry.name.endsWith("data.pgp"))) {
      throw new ImportError("encrypted");
    }
    const data = entries.find((entry) => entry.name.endsWith("data.json"));
    if (!data) throw new ImportError("unrecognized");
    return fromJson(new TextDecoder().decode(await data.read()));
  }

  const content = new TextDecoder().decode(bytes).trim();
  if (content.startsWith("-----BEGIN PGP")) throw new ImportError("encrypted");
  if (content.startsWith("{")) return fromJson(content);
  return fromCsv(content);
}

function totpFrom(entry: ProtonEntry, title: string) {
  const candidates = [entry.totp, ...entry.extraFields.filter((f) => f.totp).map((f) => f.value)];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      return { totp: parseTotpInput(candidate, title), unreadable: [] };
    } catch {
      continue;
    }
  }
  return { totp: undefined, unreadable: candidates.filter(Boolean) };
}

function joinNote(parts: (string | false | undefined)[]): string | undefined {
  const note = parts.filter((part): part is string => Boolean(part && part.trim())).join("\n\n");
  return note || undefined;
}

function toDrafts(entry: ProtonEntry): ItemDraft[] | SkipReason {
  if (entry.trashed) return "trashed";
  switch (entry.type) {
    case "login": {
      const url = entry.urls[0];
      const title = entry.name || (url && registrableDomain(url)) || entry.username || entry.email;
      if (!title && !entry.password) return "other";
      const username = entry.username || entry.email || undefined;
      const { totp, unreadable } = totpFrom(entry, title);
      const fields = entry.extraFields.filter((field) => !field.totp && field.value);
      const [passkey, ...otherPasskeys] = entry.passkeys;
      const login: ItemDraft = {
        title: title || "Login",
        url,
        username,
        password: entry.password || undefined,
        totp,
        note: joinNote([
          entry.note,
          entry.username &&
            entry.email &&
            entry.email !== entry.username &&
            `Email: ${entry.email}`,
          entry.urls.length > 1 && `Websites:\n${entry.urls.slice(1).join("\n")}`,
          ...fields.map((field) => `${field.name}: ${field.value}`),
          ...unreadable.map((uri) => `2FA: ${uri}`),
        ]),
        passkey,
        createdAt: entry.createTime,
      };
      return [
        login,
        ...otherPasskeys.map((extra) => ({
          title: login.title,
          url: extra.rpId,
          username: extra.userName || undefined,
          passkey: extra,
          createdAt: extra.createdAt,
        })),
      ];
    }
    case "note":
      if (!entry.name && !entry.note) return "other";
      return [
        { title: entry.name || "Note", note: entry.note || undefined, createdAt: entry.createTime },
      ];
    case "wifi":
      return [
        {
          title: entry.name || entry.ssid || "Wi-Fi",
          username: entry.ssid || undefined,
          password: entry.password || undefined,
          note: joinNote([entry.note]),
          createdAt: entry.createTime,
        },
      ];
    case "alias":
      return "alias";
    case "creditCard":
      return "card";
    case "identity":
      return "identity";
    default:
      return "other";
  }
}

export function planImport(entries: ProtonEntry[], existing: VaultItem[]): ImportPlan {
  const plan: ImportPlan = { items: [], passkeysForExisting: [], skipped: {} };
  const skip = (reason: SkipReason, count = 1) => {
    if (count > 0) plan.skipped[reason] = (plan.skipped[reason] ?? 0) + count;
  };
  const inVault = new Map(existing.map((item) => [duplicateKey(item), item]));
  const planned = new Map<string, ItemDraft>();
  const knownPasskeys = new Set(existing.flatMap((item) => item.passkey?.credentialId ?? []));

  for (const entry of entries) {
    skip("passkey", entry.unreadablePasskeys);
    const drafts = toDrafts(entry);
    if (typeof drafts === "string") {
      skip(drafts);
      continue;
    }
    for (const found of drafts) {
      const passkey =
        found.passkey && !knownPasskeys.has(found.passkey.credentialId) ? found.passkey : undefined;
      if (passkey) knownPasskeys.add(passkey.credentialId);
      const draft = { ...found, passkey };
      const key = duplicateKey(draft);
      const saved = inVault.get(key);
      const pending = planned.get(key);

      if (saved && passkey && !saved.passkey) {
        const updated = { ...saved, passkey };
        inVault.set(key, updated);
        plan.passkeysForExisting.push(updated);
      } else if (pending && passkey && !pending.passkey) {
        pending.passkey = passkey;
      } else if (saved || pending) {
        skip("duplicate");
      } else {
        planned.set(key, draft);
        plan.items.push(draft);
      }
    }
  }
  return plan;
}
