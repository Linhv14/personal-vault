import { cardDigits } from "../item-types.js";
import { registrableDomain, type ItemDraft } from "../vault.js";
import {
  cardExpiry,
  countSkip,
  firstTotp,
  joinNote,
  lines,
  list,
  object,
  text,
  type ImportSource,
  type JsonObject,
} from "./source.js";

const LOGIN_LIKE = new Set(["001", "005", "102", "110", "111", "112"]);
const CREDIT_CARD = "002";
const SECURE_NOTE = "003";
const IDENTITY = "004";
const DOCUMENT = "006";
const WIRELESS_ROUTER = "109";

interface Field {
  id: string;
  title: string;
  kind: string;
  value: string;
  raw: unknown;
}

export function isOnePasswordExport(parsed: JsonObject): boolean {
  return Array.isArray(parsed.accounts);
}

function fieldValue(kind: string, raw: unknown): string {
  switch (kind) {
    case "email":
      return text(object(raw).email_address);
    case "address": {
      const address = object(raw);
      return ["street", "city", "state", "zip", "country"]
        .map((key) => text(address[key]).trim())
        .filter(Boolean)
        .join(", ");
    }
    case "monthYear": {
      const digits = text(raw);
      return digits.length === 6 ? `${digits.slice(4)}/${digits.slice(0, 4)}` : digits;
    }
    case "date":
      return typeof raw === "number" ? new Date(raw * 1000).toISOString().slice(0, 10) : "";
    case "sshKey":
      return text(object(raw).privateKey);
    default:
      return text(raw);
  }
}

function sectionFields(details: JsonObject): Field[] {
  return list(details.sections).flatMap((section) =>
    list(object(section).fields).flatMap((raw): Field[] => {
      const field = object(raw);
      const value = object(field.value);
      const [kind] = Object.keys(value);
      if (!kind) return [];
      const read = fieldValue(kind, value[kind]);
      return read.trim()
        ? [
            {
              id: text(field.id),
              title: text(field.title) || text(field.id),
              kind,
              value: read,
              raw: value[kind],
            },
          ]
        : [];
    }),
  );
}

function take(fields: Field[], match: (field: Field) => boolean): string | undefined {
  const index = fields.findIndex(match);
  if (index < 0) return undefined;
  const [field] = fields.splice(index, 1);
  return field?.value;
}

function byId(fields: Field[], id: string): string | undefined {
  return take(fields, (field) => field.id === id);
}

function rest(fields: Field[]): string {
  return lines(fields.map((field): [string, string] => [field.title, field.value]));
}

function loginDraft(item: JsonObject, details: JsonObject, fields: Field[]): ItemDraft {
  const overview = object(item.overview);
  const loginFields = list(details.loginFields).map(object);
  const designated = (name: string) =>
    text(loginFields.find((field) => field.designation === name)?.value) || undefined;
  const urls = [text(overview.url), ...list(overview.urls).map((entry) => text(object(entry).url))]
    .map((url) => url.trim())
    .filter((url, index, all) => url && all.indexOf(url) === index);

  const username =
    designated("username") ?? take(fields, (field) => field.title.toLowerCase() === "username");
  const password =
    designated("password") ??
    (text(details.password) || undefined) ??
    take(fields, (field) => field.title.toLowerCase() === "password");
  const url = urls[0] ?? take(fields, (field) => field.id === "url" || field.kind === "url");
  const title = text(overview.title) || (url && registrableDomain(url)) || username || "Login";
  const totpCandidates = fields.filter(
    (field) => field.kind === "totp" || field.id.startsWith("TOTP_"),
  );
  for (const candidate of totpCandidates) fields.splice(fields.indexOf(candidate), 1);
  const { totp, unreadable } = firstTotp(
    totpCandidates.map((field) => field.value),
    title,
  );

  return {
    title,
    url,
    username,
    password,
    totp,
    note: joinNote([
      text(details.notesPlain),
      urls.length > 1 && `Websites:\n${urls.slice(1).join("\n")}`,
      rest(fields),
      ...unreadable.map((uri) => `2FA: ${uri}`),
    ]),
  };
}

function cardDraft(title: string, details: JsonObject, fields: Field[]): ItemDraft {
  const expiry = byId(fields, "expiry") ?? "";
  const [month = "", year = ""] = expiry.split("/");
  return {
    type: "card",
    title: title || "Card",
    cardholder: byId(fields, "cardholder"),
    cardNumber: cardDigits(byId(fields, "ccnum")) || undefined,
    cardExpiry: cardExpiry(month, year),
    cardCvv: byId(fields, "cvv"),
    cardPin: byId(fields, "pin"),
    note: joinNote([text(details.notesPlain), rest(fields)]),
  };
}

function identityDraft(title: string, details: JsonObject, fields: Field[]): ItemDraft {
  const addressField = fields.find((field) => field.kind === "address");
  if (addressField) fields.splice(fields.indexOf(addressField), 1);
  const address = object(addressField?.raw);
  const fullName = [byId(fields, "firstname"), byId(fields, "initial"), byId(fields, "lastname")]
    .filter(Boolean)
    .join(" ");
  const part = (key: string) => text(address[key]).trim() || undefined;
  return {
    type: "identity",
    title: title || fullName || "Address",
    fullName: fullName || undefined,
    email: byId(fields, "email"),
    phone: byId(fields, "defphone"),
    company: byId(fields, "company"),
    address: part("street"),
    city: part("city"),
    region: part("state"),
    postalCode: part("zip"),
    country: part("country"),
    note: joinNote([text(details.notesPlain), rest(fields)]),
  };
}

function itemDraft(item: JsonObject): ItemDraft | null {
  const category = text(item.categoryUuid);
  const details = object(item.details);
  const fields = sectionFields(details);
  const title = text(object(item.overview).title);

  let draft: ItemDraft;
  if (LOGIN_LIKE.has(category)) draft = loginDraft(item, details, fields);
  else if (category === CREDIT_CARD) draft = cardDraft(title, details, fields);
  else if (category === IDENTITY) draft = identityDraft(title, details, fields);
  else if (category === WIRELESS_ROUTER) {
    draft = {
      type: "wifi",
      title: title || "Wi-Fi",
      ssid: byId(fields, "network_name"),
      password: byId(fields, "wireless_password"),
      note: joinNote([text(details.notesPlain), rest(fields)]),
    };
  } else if (category === DOCUMENT) return null;
  else {
    draft = {
      type: "note",
      title: title || "Note",
      note: joinNote([text(details.notesPlain), category === SECURE_NOTE ? "" : rest(fields)]),
    };
  }
  return { ...draft, createdAt: typeof item.createdAt === "number" ? item.createdAt : undefined };
}

export function onePasswordFromExport(parsed: JsonObject): ImportSource {
  const source: ImportSource = { format: "1password", drafts: [], skipped: {} };
  const items = list(parsed.accounts).flatMap((account) =>
    list(object(account).vaults).flatMap((vault) => list(object(vault).items).map(object)),
  );
  for (const item of items) {
    const draft = itemDraft(item);
    if (draft) source.drafts.push(draft);
    else countSkip(source.skipped, "other");
  }
  return source;
}
