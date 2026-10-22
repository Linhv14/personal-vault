import type { StoredPasskey } from "../passkey/authenticator.js";
import { cardDigits, normalizeExpiry } from "../item-types.js";
import { registrableDomain } from "../../../src/core/site.js";
import type { ItemDraft } from "../vault.js";
import { decryptWithPassphrase, OpenPgpError, type OpenPgpErrorCode } from "./openpgp.js";
import { readProtonPasskey, type ProtonPasskeyFields } from "./proton-passkey.js";
import {
  countSkip,
  customFields,
  firstTotp,
  ImportError,
  list,
  object,
  text,
  type FieldEntry,
  type ImportErrorCode,
  type ImportSource,
  type JsonObject,
  type SkipReason,
} from "./source.js";

interface ExtraField {
  name: string;
  value: string;
  totp: boolean;
  hidden: boolean;
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
  content: JsonObject;
  extraFields: ExtraField[];
  createTime?: number;
  trashed: boolean;
  passkeyFields: ProtonPasskeyFields[];
  passkeys: StoredPasskey[];
  unreadablePasskeys: number;
}

const TRASHED = 2;

function extraFields(value: unknown): ExtraField[] {
  return list(value).map((raw): ExtraField => {
    const field = object(raw);
    const data = object(field.data);
    return {
      name: text(field.fieldName),
      value: text(data.content ?? data.totpUri ?? data.timestamp),
      totp: field.type === "totp",
      hidden: field.type === "hidden",
    };
  });
}

function sectionFields(sections: unknown): ExtraField[] {
  return list(sections).flatMap((raw) => {
    const section = object(raw);
    return extraFields(section.sectionFields).map((extra) => ({
      ...extra,
      name: [text(section.sectionName), extra.name].filter(Boolean).join(" · "),
    }));
  });
}

function asEntries(fields: ExtraField[]): FieldEntry[] {
  return fields
    .filter((field) => !field.totp)
    .map((field) => ({ label: field.name, value: field.value, hidden: field.hidden }));
}

function fromJsonItem(raw: unknown): ProtonEntry {
  const item = object(raw);
  const data = object(item.data);
  const content = object(data.content);
  const metadata = object(data.metadata);
  const urls = Array.isArray(content.urls)
    ? content.urls.map(text)
    : list(content.autofillUrls).map((entry) => text(object(entry).url));
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
    content,
    extraFields: extraFields(data.extraFields),
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

export function isProtonJson(parsed: JsonObject): boolean {
  return (
    typeof parsed.vaults === "object" && parsed.vaults !== null && !Array.isArray(parsed.vaults)
  );
}

export async function protonFromJson(parsed: JsonObject): Promise<ImportSource> {
  if (parsed.encrypted === true) {
    throw new ImportError("unsupported_encryption");
  }
  return toSource(
    Object.values(object(parsed.vaults)).flatMap((vault) =>
      list(object(vault).items).map(fromJsonItem),
    ),
  );
}

export function isProtonCsv(header: string[]): boolean {
  return ["type", "name", "url", "email", "username", "password", "note", "totp", "vault"].every(
    (column) => header.includes(column),
  );
}

export async function protonFromCsv(records: Record<string, string>[]): Promise<ImportSource> {
  return toSource(
    records.map((row) => {
      const structured = STRUCTURED_IN_CSV.has(row.type ?? "") ? parseObject(row.note) : null;
      return {
        type: row.type ?? "",
        name: row.name ?? "",
        urls: (row.url ?? "")
          .split(",")
          .map((url) => url.trim())
          .filter(Boolean),
        email: row.email ?? "",
        username: row.username ?? "",
        password: row.password ?? "",
        note: structured ? text(structured.note) : (row.note ?? ""),
        totp: row.totp ?? "",
        ssid: "",
        content: structured ?? {},
        extraFields: [],
        createTime: Number(row.createtime) || undefined,
        trashed: false,
        passkeyFields: [],
        passkeys: [],
        unreadablePasskeys: 0,
      };
    }),
  );
}

const STRUCTURED_IN_CSV = new Set(["creditCard", "identity"]);

function parseObject(json: string | undefined): JsonObject | null {
  try {
    return object(JSON.parse(json ?? ""));
  } catch {
    return null;
  }
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

const OPENPGP_ERRORS: Record<OpenPgpErrorCode, ImportErrorCode> = {
  wrong_passphrase: "wrong_passphrase",
  unsupported: "unsupported_encryption",
  damaged: "damaged",
};

export async function decryptProtonPgp(
  message: Uint8Array,
  passphrase: string | undefined,
): Promise<string> {
  if (!passphrase) {
    throw new ImportError("needs_passphrase");
  }
  try {
    return new TextDecoder().decode(await decryptWithPassphrase(message, passphrase));
  } catch (error) {
    if (error instanceof OpenPgpError) {
      throw new ImportError(OPENPGP_ERRORS[error.code]);
    }
    throw error;
  }
}

function protonExpiry(raw: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})$/.exec(raw);
  return (
    (iso?.[1] && iso[2] && normalizeExpiry(`${iso[2]}/${iso[1]}`)) ||
    normalizeExpiry(raw) ||
    undefined
  );
}

function cardDraft(entry: ProtonEntry): ItemDraft {
  const { content } = entry;
  const rawExpiry = text(content.expirationDate);
  const expiry = protonExpiry(rawExpiry);
  return {
    type: "card",
    title: entry.name || "Card",
    cardholder: text(content.cardholderName) || undefined,
    cardNumber: cardDigits(text(content.number)) || undefined,
    cardExpiry: expiry,
    cardCvv: text(content.verificationNumber) || undefined,
    cardPin: text(content.pin) || undefined,
    note: entry.note || undefined,
    fields: customFields([
      { label: "Expiry", value: expiry ? undefined : rawExpiry },
      ...asEntries(entry.extraFields),
    ]),
    createdAt: entry.createTime,
  };
}

const IDENTITY_EXTRAS: [string, string, boolean?][] = [
  ["birthdate", "Birthdate"],
  ["gender", "Gender"],
  ["floor", "Floor"],
  ["county", "County"],
  ["socialSecurityNumber", "Social security number", true],
  ["passportNumber", "Passport number"],
  ["licenseNumber", "License number"],
  ["website", "Website"],
  ["secondPhoneNumber", "Second phone"],
  ["xHandle", "X"],
  ["linkedin", "LinkedIn"],
  ["reddit", "Reddit"],
  ["facebook", "Facebook"],
  ["yahoo", "Yahoo"],
  ["instagram", "Instagram"],
  ["jobTitle", "Job title"],
  ["personalWebsite", "Personal website"],
  ["workPhoneNumber", "Work phone"],
  ["workEmail", "Work email"],
];

const IDENTITY_EXTRA_LISTS = [
  "extraPersonalDetails",
  "extraAddressDetails",
  "extraContactDetails",
  "extraWorkDetails",
];

function identityDraft(entry: ProtonEntry): ItemDraft {
  const { content } = entry;
  const field = (key: string) => text(content[key]).trim() || undefined;
  const fullName =
    field("fullName") ||
    [field("firstName"), field("middleName"), field("lastName")].filter(Boolean).join(" ") ||
    undefined;
  return {
    type: "identity",
    title: entry.name || fullName || "Address",
    fullName,
    email: field("email"),
    phone: field("phoneNumber"),
    company: field("organization") || field("company"),
    address: field("streetAddress"),
    city: field("city"),
    region: field("stateOrProvince"),
    postalCode: field("zipOrPostalCode"),
    country: field("countryOrRegion"),
    note: entry.note || undefined,
    fields: customFields([
      ...IDENTITY_EXTRAS.map(([key, label, hidden]) => ({ label, value: field(key), hidden })),
      ...asEntries(IDENTITY_EXTRA_LISTS.flatMap((key) => extraFields(content[key]))),
      ...asEntries(sectionFields(content.extraSections)),
      ...asEntries(entry.extraFields),
    ]),
    createdAt: entry.createTime,
  };
}

function toDrafts(entry: ProtonEntry): ItemDraft[] | SkipReason {
  if (entry.trashed) {
    return "trashed";
  }
  const sections = sectionFields(entry.content.sections);
  const extras = [...entry.extraFields, ...sections];
  switch (entry.type) {
    case "login": {
      const url = entry.urls[0];
      const title = entry.name || (url && registrableDomain(url)) || entry.username || entry.email;
      if (!title && !entry.password) {
        return "other";
      }
      const username = entry.username || entry.email || undefined;
      const { totp, unreadable } = firstTotp(
        [entry.totp, ...extras.filter((field) => field.totp).map((field) => field.value)],
        title,
      );
      const [passkey, ...otherPasskeys] = entry.passkeys;
      const login: ItemDraft = {
        title: title || "Login",
        url,
        urls: entry.urls.length > 1 ? entry.urls.slice(1) : undefined,
        username,
        password: entry.password || undefined,
        totp,
        note: entry.note || undefined,
        fields: customFields([
          {
            label: "Email",
            value: entry.username && entry.email !== entry.username ? entry.email : undefined,
          },
          ...asEntries(extras),
          ...unreadable.map((uri) => ({ label: "2FA", value: uri, hidden: true })),
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
    case "custom":
      if (!entry.name && !entry.note && extras.length === 0) {
        return "other";
      }
      return [
        {
          type: "note",
          title: entry.name || "Note",
          note: entry.note || undefined,
          fields: customFields(asEntries(extras)),
          createdAt: entry.createTime,
        },
      ];
    case "wifi":
      return [
        {
          type: "wifi",
          title: entry.name || entry.ssid || "Wi-Fi",
          ssid: entry.ssid || undefined,
          password: entry.password || undefined,
          note: entry.note || undefined,
          fields: customFields(asEntries(extras)),
          createdAt: entry.createTime,
        },
      ];
    case "sshKey":
      return [
        {
          type: "ssh",
          title: entry.name || "SSH key",
          sshPrivateKey: text(entry.content.privateKey) || undefined,
          sshPublicKey: text(entry.content.publicKey) || undefined,
          sshFingerprint: text(entry.content.fingerprint) || undefined,
          note: entry.note || undefined,
          fields: customFields(asEntries(extras)),
          createdAt: entry.createTime,
        },
      ];
    case "alias":
      return "alias";
    case "creditCard":
      return [cardDraft(entry)];
    case "identity":
      return [identityDraft(entry)];
    default:
      return "other";
  }
}

async function toSource(entries: ProtonEntry[]): Promise<ImportSource> {
  const source: ImportSource = { format: "proton", drafts: [], skipped: {} };
  for (const entry of await withPasskeys(entries)) {
    countSkip(source.skipped, "passkey", entry.unreadablePasskeys);
    const drafts = toDrafts(entry);
    if (typeof drafts === "string") {
      countSkip(source.skipped, drafts);
    } else {
      source.drafts.push(...drafts);
    }
  }
  return source;
}
