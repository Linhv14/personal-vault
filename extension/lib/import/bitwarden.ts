import { fromBase64, fromBase64Url, toBase64Url } from "#core/bytes.js";
import { cardDigits } from "../item-types.js";
import type { StoredPasskey } from "../passkey/authenticator.js";
import { registrableDomain } from "#core/site.js";
import type { ItemDraft } from "../vault/types.js";
import type { CustomField } from "../item-types.js";
import {
  cardExpiry,
  countSkip,
  customFields,
  firstTotp,
  ImportError,
  list,
  object,
  text,
  type FieldEntry,
  type ImportSource,
  type JsonObject,
} from "./source.js";

const LOGIN = 1;
const SECURE_NOTE = 2;
const CARD = 3;
const IDENTITY = 4;
const SSH_KEY = 5;
const KDF_PBKDF2 = 0;
const KDF_ARGON2ID = 1;
const FIELD_LINKED = 3;
const ENC_AES_CBC_HMAC = "2.";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBitwardenJson(parsed: JsonObject): boolean {
  return (
    typeof parsed.encrypted === "boolean" &&
    (Array.isArray(parsed.items) || typeof parsed.data === "string")
  );
}

export function isBitwardenCsv(header: string[]): boolean {
  return ["type", "name", "login_uri", "login_username", "login_password"].every((column) =>
    header.includes(column),
  );
}

async function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hkdfExpand(prk: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await hmacKey(prk);
  const input = new Uint8Array([...new TextEncoder().encode(info), 1]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
}

const MAX_PBKDF2_ITERATIONS = 2_000_000;

interface ExportKey {
  encryption: CryptoKey;
  mac: CryptoKey;
}

async function exportKey(passphrase: string, file: JsonObject): Promise<ExportKey> {
  if (file.kdfType === KDF_ARGON2ID) {
    throw new ImportError("argon2");
  }
  const iterations = file.kdfIterations;
  if (
    file.kdfType !== KDF_PBKDF2 ||
    typeof iterations !== "number" ||
    iterations < 1 ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new ImportError("unsupported_encryption");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const master = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new TextEncoder().encode(text(file.salt)),
        iterations,
      },
      material,
      256,
    ),
  );
  const [encryption, mac] = await Promise.all([
    hkdfExpand(master, "enc"),
    hkdfExpand(master, "mac"),
  ]);
  return {
    encryption: await crypto.subtle.importKey("raw", new Uint8Array(encryption), "AES-CBC", false, [
      "decrypt",
    ]),
    mac: await hmacKey(mac),
  };
}

async function decryptEncString(value: string, key: ExportKey): Promise<string> {
  if (!value.startsWith(ENC_AES_CBC_HMAC)) {
    throw new ImportError("unsupported_encryption");
  }
  const [iv, data, mac] = value
    .slice(ENC_AES_CBC_HMAC.length)
    .split("|")
    .map((part) => {
      try {
        return fromBase64(part);
      } catch {
        throw new ImportError("damaged");
      }
    });
  if (!iv || !data || !mac) {
    throw new ImportError("damaged");
  }
  const signed = new Uint8Array([...iv, ...data]);
  if (!(await crypto.subtle.verify("HMAC", key.mac, new Uint8Array(mac), signed))) {
    throw new ImportError("wrong_passphrase");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(iv) },
    key.encryption,
    new Uint8Array(data),
  );
  return new TextDecoder().decode(plain);
}

function credentialIdBytes(id: string): Uint8Array {
  if (id.startsWith("b64.")) {
    return fromBase64Url(id.slice(4));
  }
  if (!GUID.test(id)) {
    throw new Error("Unknown credential id format");
  }
  const hex = id.replaceAll("-", "");
  return Uint8Array.from({ length: 16 }, (_, index) =>
    parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function seconds(value: unknown): number | undefined {
  const time = Date.parse(text(value));
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000);
}

async function readPasskey(raw: unknown): Promise<StoredPasskey | null> {
  const credential = object(raw);
  if (credential.keyAlgorithm !== "ECDSA" || credential.keyCurve !== "P-256") {
    return null;
  }
  const rpId = text(credential.rpId);
  if (!rpId) {
    return null;
  }
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      fromBase64Url(text(credential.keyValue)),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    const userHandle = text(credential.userHandle);
    return {
      credentialId: toBase64Url(credentialIdBytes(text(credential.credentialId))),
      rpId,
      userHandle: userHandle ? toBase64Url(fromBase64Url(userHandle)) : "",
      userName: text(credential.userName),
      userDisplayName: text(credential.userDisplayName) || undefined,
      privateKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", key))),
      createdAt: seconds(credential.creationDate) ?? Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

const FIELD_HIDDEN = 1;
const BANK_ACCOUNT = 6;
const DRIVERS_LICENSE = 7;
const PASSPORT = 8;

function itemFields(item: JsonObject, extra: FieldEntry[] = []): CustomField[] | undefined {
  return customFields([
    ...extra,
    ...list(item.fields)
      .map(object)
      .filter((field) => field.type !== FIELD_LINKED)
      .map((field) => ({
        label: text(field.name),
        value: text(field.value),
        hidden: field.type === FIELD_HIDDEN,
      })),
  ]);
}

function common(item: JsonObject, extra: FieldEntry[] = []) {
  return {
    note: text(item.notes) || undefined,
    fields: itemFields(item, extra),
    createdAt: seconds(item.creationDate),
  };
}

function history(item: JsonObject) {
  const changes = list(item.passwordHistory)
    .map(object)
    .flatMap((change) => {
      const password = text(change.password);
      return password ? [{ password, changedAt: seconds(change.lastUsedDate) ?? 0 }] : [];
    });
  return changes.length > 0 ? changes : undefined;
}

async function loginDrafts(item: JsonObject, source: ImportSource): Promise<ItemDraft[]> {
  const login = object(item.login);
  const uris = list(login.uris)
    .map((uri) => text(object(uri).uri).trim())
    .filter(Boolean);
  const url = uris[0];
  const username = text(login.username) || undefined;
  const title = text(item.name) || (url && registrableDomain(url)) || username || "Login";
  const { totp, unreadable } = firstTotp([text(login.totp)], title);
  const read = await Promise.all(list(login.fido2Credentials).map(readPasskey));
  const [passkey, ...otherPasskeys] = read.filter((key): key is StoredPasskey => key !== null);
  countSkip(source.skipped, "passkey", read.length - read.filter(Boolean).length);

  const draft: ItemDraft = {
    title,
    url,
    urls: uris.length > 1 ? uris.slice(1) : undefined,
    username,
    password: text(login.password) || undefined,
    totp,
    passkey,
    passwordHistory: history(item),
    ...common(
      item,
      unreadable.map((uri) => ({ label: "2FA", value: uri, hidden: true })),
    ),
  };
  return [
    draft,
    ...otherPasskeys.map((extra) => ({
      title,
      url: extra.rpId,
      username: extra.userName || undefined,
      passkey: extra,
      createdAt: extra.createdAt,
    })),
  ];
}

function cardDraft(item: JsonObject): ItemDraft {
  const card = object(item.card);
  return {
    type: "card",
    title: text(item.name) || "Card",
    cardholder: text(card.cardholderName) || undefined,
    cardNumber: cardDigits(text(card.number)) || undefined,
    cardExpiry: cardExpiry(text(card.expMonth), text(card.expYear)),
    cardCvv: text(card.code) || undefined,
    ...common(item, [{ label: "Brand", value: text(card.brand) }]),
  };
}

function identityDraft(item: JsonObject): ItemDraft {
  const identity = object(item.identity);
  const field = (key: string) => text(identity[key]).trim() || undefined;
  const fullName = [field("firstName"), field("middleName"), field("lastName")]
    .filter(Boolean)
    .join(" ");
  return {
    type: "identity",
    title: text(item.name) || fullName || "Address",
    fullName: fullName || undefined,
    email: field("email"),
    phone: field("phone"),
    company: field("company"),
    address:
      [field("address1"), field("address2"), field("address3")].filter(Boolean).join("\n") ||
      undefined,
    city: field("city"),
    region: field("state"),
    postalCode: field("postalCode"),
    country: field("country"),
    ...common(item, [
      { label: "Title", value: field("title") },
      { label: "Username", value: field("username") },
      { label: "Social security number", value: field("ssn"), hidden: true },
      { label: "Passport number", value: field("passportNumber") },
      { label: "License number", value: field("licenseNumber") },
    ]),
  };
}

function bankDraft(item: JsonObject): ItemDraft {
  const bank = object(item.bankAccount);
  const field = (key: string) => text(bank[key]).trim() || undefined;
  return {
    type: "bank",
    title: text(item.name) || field("bankName") || "Bank account",
    bankName: field("bankName"),
    fullName: field("nameOnAccount"),
    accountNumber: field("accountNumber"),
    routingNumber: field("routingNumber") ?? field("branchNumber"),
    swift: field("swiftCode"),
    iban: field("iban"),
    pin: field("pin"),
    ...common(item, [
      { label: "Account type", value: field("accountType") },
      { label: "Phone", value: field("bankContactPhone") },
    ]),
  };
}

function documentDraft(item: JsonObject, kind: "driversLicense" | "passport"): ItemDraft {
  const data = object(item[kind]);
  const field = (key: string) => text(data[key]).trim() || undefined;
  const fullName =
    kind === "passport"
      ? [field("givenName"), field("surname")].filter(Boolean).join(" ")
      : [field("firstName"), field("middleName"), field("lastName")].filter(Boolean).join(" ");
  return {
    type: "document",
    title: text(item.name) || (kind === "passport" ? "Passport" : "Driver's license"),
    documentKind: kind === "passport" ? "Passport" : "Driver's license",
    fullName: fullName || undefined,
    documentNumber: field(kind === "passport" ? "passportNumber" : "licenseNumber"),
    issuedOn: field("issueDate"),
    expiresOn: field("expirationDate"),
    issuer: field("issuingAuthority"),
    country: field("issuingCountry"),
    ...common(item, [
      { label: "Date of birth", value: field("dateOfBirth") },
      { label: "State", value: field("issuingState") },
      { label: "Class", value: field("licenseClass") },
      { label: "Nationality", value: field("nationality") },
      { label: "Place of birth", value: field("birthPlace") },
      { label: "Sex", value: field("sex") },
      { label: "Type", value: field("passportType") },
      { label: "National ID", value: field("nationalIdentificationNumber") },
    ]),
  };
}

function sshDraft(item: JsonObject): ItemDraft {
  const key = object(item.sshKey);
  return {
    type: "ssh",
    title: text(item.name) || "SSH key",
    sshPublicKey: text(key.publicKey) || undefined,
    sshFingerprint: text(key.keyFingerprint) || undefined,
    sshPrivateKey: text(key.privateKey) || undefined,
    ...common(item),
  };
}

async function fromItems(items: unknown[]): Promise<ImportSource> {
  const source: ImportSource = { format: "bitwarden", drafts: [], skipped: {} };
  for (const raw of items) {
    const item = object(raw);
    if (item.deletedDate) {
      countSkip(source.skipped, "trashed");
      continue;
    }
    switch (item.type) {
      case LOGIN:
        source.drafts.push(...(await loginDrafts(item, source)));
        break;
      case SECURE_NOTE:
        source.drafts.push({ type: "note", title: text(item.name) || "Note", ...common(item) });
        break;
      case CARD:
        source.drafts.push(cardDraft(item));
        break;
      case IDENTITY:
        source.drafts.push(identityDraft(item));
        break;
      case SSH_KEY:
        source.drafts.push(sshDraft(item));
        break;
      case BANK_ACCOUNT:
        source.drafts.push(bankDraft(item));
        break;
      case DRIVERS_LICENSE:
        source.drafts.push(documentDraft(item, "driversLicense"));
        break;
      case PASSPORT:
        source.drafts.push(documentDraft(item, "passport"));
        break;
      default:
        countSkip(source.skipped, "other");
    }
  }
  return source;
}

export async function bitwardenFromJson(
  parsed: JsonObject,
  passphrase: string | undefined,
): Promise<ImportSource> {
  if (parsed.passwordProtected === true) {
    if (!passphrase) {
      throw new ImportError("needs_passphrase");
    }
    const key = await exportKey(passphrase, parsed);
    await decryptEncString(text(parsed.encKeyValidation_DO_NOT_EDIT), key);
    let inner: JsonObject;
    try {
      inner = object(JSON.parse(await decryptEncString(text(parsed.data), key)));
    } catch (error) {
      if (error instanceof ImportError) {
        throw error;
      }
      throw new ImportError("damaged");
    }
    return bitwardenFromJson(inner, undefined);
  }
  if (parsed.encrypted === true) {
    throw new ImportError("account_encrypted");
  }
  return fromItems(list(parsed.items));
}

export async function bitwardenFromCsv(records: Record<string, string>[]): Promise<ImportSource> {
  return fromItems(
    records.map((row) => ({
      type: row.type === "note" ? SECURE_NOTE : LOGIN,
      name: row.name,
      notes: row.notes,
      fields: (row.fields ?? "").split(/\r?\n/).flatMap((line) => {
        const at = line.lastIndexOf(": ");
        return at > 0 ? [{ name: line.slice(0, at), value: line.slice(at + 2) }] : [];
      }),
      login: {
        uris: (row.login_uri ?? "").split(",").map((uri) => ({ uri: uri.trim() })),
        username: row.login_username,
        password: row.login_password,
        totp: row.login_totp,
      },
    })),
  );
}
