import { cardDigits, type CustomField } from "../item-types.js";
import { registrableDomain, type ItemDraft } from "../vault.js";
import {
  cardExpiry,
  countSkip,
  customFields,
  firstTotp,
  list,
  object,
  text,
  type FieldEntry,
  type ImportSource,
  type JsonObject,
} from "./source.js";

const LOGIN_LIKE = new Set(["001", "005", "102", "110", "111"]);
const CREDIT_CARD = "002";
const IDENTITY = "004";
const DOCUMENT_FILE = "006";
const SOFTWARE_LICENSE = "100";
const BANK_ACCOUNT = "101";
const WIRELESS_ROUTER = "109";
const API_CREDENTIAL = "112";
const SSH_KEY = "114";
const ID_DOCUMENTS: Record<string, string> = {
  "103": "Driver's license",
  "106": "Passport",
  "108": "Social security number",
};

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
      if (!kind) {
        return [];
      }
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

function take(fields: Field[], match: (field: Field) => boolean): Field | undefined {
  const index = fields.findIndex(match);
  return index < 0 ? undefined : fields.splice(index, 1)[0];
}

function byId(fields: Field[], ...ids: string[]): string | undefined {
  return take(fields, (field) => ids.includes(field.id))?.value;
}

function rest(fields: Field[], extra: FieldEntry[] = []): CustomField[] | undefined {
  return customFields([
    ...extra,
    ...fields.map((field) => ({
      label: field.title,
      value: field.value,
      hidden: field.kind === "concealed",
    })),
  ]);
}

function passwordHistory(details: JsonObject) {
  const changes = list(details.passwordHistory)
    .map(object)
    .flatMap((change) => {
      const password = text(change.value);
      const time = change.time;
      return password ? [{ password, changedAt: typeof time === "number" ? time : 0 }] : [];
    });
  return changes.length > 0 ? changes : undefined;
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
    designated("username") ??
    take(fields, (field) => field.title.toLowerCase() === "username")?.value;
  const password =
    designated("password") ??
    (text(details.password) || undefined) ??
    take(fields, (field) => field.title.toLowerCase() === "password")?.value;
  const url = urls[0] ?? take(fields, (field) => field.id === "url" || field.kind === "url")?.value;
  const title = text(overview.title) || (url && registrableDomain(url)) || username || "Login";
  const totpCandidates = fields.filter(
    (field) => field.kind === "totp" || field.id.startsWith("TOTP_"),
  );
  for (const candidate of totpCandidates) {
    fields.splice(fields.indexOf(candidate), 1);
  }
  const { totp, unreadable } = firstTotp(
    totpCandidates.map((field) => field.value),
    title,
  );

  return {
    title,
    url,
    urls: urls.length > 1 ? urls.slice(1) : undefined,
    username,
    password,
    totp,
    passwordHistory: passwordHistory(details),
    fields: rest(
      fields,
      unreadable.map((uri) => ({ label: "2FA", value: uri, hidden: true })),
    ),
  };
}

function cardDraft(title: string, fields: Field[]): ItemDraft {
  const [month = "", year = ""] = (byId(fields, "expiry") ?? "").split("/");
  return {
    type: "card",
    title: title || "Card",
    cardholder: byId(fields, "cardholder"),
    cardNumber: cardDigits(byId(fields, "ccnum")) || undefined,
    cardExpiry: cardExpiry(month, year),
    cardCvv: byId(fields, "cvv"),
    cardPin: byId(fields, "pin"),
    fields: rest(fields),
  };
}

function identityDraft(title: string, fields: Field[]): ItemDraft {
  const address = object(take(fields, (field) => field.kind === "address")?.raw);
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
    fields: rest(fields),
  };
}

function itemDraft(item: JsonObject): ItemDraft | null {
  const category = text(item.categoryUuid);
  const details = object(item.details);
  const fields = sectionFields(details);
  const title = text(object(item.overview).title);
  const documentKind = ID_DOCUMENTS[category];

  let draft: ItemDraft;
  if (LOGIN_LIKE.has(category)) {
    draft = loginDraft(item, details, fields);
  } else if (category === CREDIT_CARD) {
    draft = cardDraft(title, fields);
  } else if (category === IDENTITY) {
    draft = identityDraft(title, fields);
  } else if (category === WIRELESS_ROUTER) {
    draft = {
      type: "wifi",
      title: title || "Wi-Fi",
      ssid: byId(fields, "network_name"),
      password: byId(fields, "wireless_password"),
      fields: rest(fields),
    };
  } else if (category === BANK_ACCOUNT) {
    draft = {
      type: "bank",
      title: title || "Bank account",
      bankName: byId(fields, "bankName"),
      fullName: byId(fields, "owner"),
      accountNumber: byId(fields, "accountNo"),
      routingNumber: byId(fields, "routingNo"),
      swift: byId(fields, "swift"),
      iban: byId(fields, "iban"),
      pin: byId(fields, "telephonePin"),
      fields: rest(fields),
    };
  } else if (documentKind) {
    draft = {
      type: "document",
      title: title || documentKind,
      documentKind,
      fullName: byId(fields, "fullname", "name"),
      documentNumber: byId(fields, "number"),
      issuedOn: byId(fields, "issue_date"),
      expiresOn: byId(fields, "expiry_date"),
      issuer: byId(fields, "issuing_authority"),
      country: byId(fields, "issuing_country", "country"),
      fields: rest(fields),
    };
  } else if (category === SOFTWARE_LICENSE) {
    draft = {
      type: "license",
      title: title || "License",
      licenseKey: byId(fields, "reg_code"),
      version: byId(fields, "product_version"),
      fullName: byId(fields, "reg_name"),
      email: byId(fields, "reg_email"),
      expiresOn: byId(fields, "expiry_date"),
      fields: rest(fields),
    };
  } else if (category === API_CREDENTIAL) {
    draft = {
      type: "api",
      title: title || "API key",
      url: byId(fields, "hostname"),
      username: byId(fields, "username"),
      password: byId(fields, "credential"),
      expiresOn: byId(fields, "expires"),
      fields: rest(fields),
    };
  } else if (category === SSH_KEY) {
    const key = take(fields, (field) => field.kind === "sshKey");
    const metadata = object(object(key?.raw).metadata);
    draft = {
      type: "ssh",
      title: title || "SSH key",
      sshPrivateKey: key?.value,
      sshPublicKey: text(metadata.publicKey) || undefined,
      sshFingerprint: text(metadata.fingerprint) || undefined,
      fields: rest(fields),
    };
  } else if (category === DOCUMENT_FILE) {
    return null;
  } else {
    draft = { type: "note", title: title || "Note", fields: rest(fields) };
  }

  return {
    ...draft,
    note: text(details.notesPlain) || undefined,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : undefined,
  };
}

export function onePasswordFromExport(parsed: JsonObject): ImportSource {
  const source: ImportSource = { format: "1password", drafts: [], skipped: {} };
  const items = list(parsed.accounts).flatMap((account) =>
    list(object(account).vaults).flatMap((vault) => list(object(vault).items).map(object)),
  );
  for (const item of items) {
    const draft = itemDraft(item);
    if (draft) {
      source.drafts.push(draft);
    } else {
      countSkip(source.skipped, "other");
    }
  }
  return source;
}
