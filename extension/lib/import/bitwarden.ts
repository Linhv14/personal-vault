import { fromBase64 } from "../../../src/core/bytes.js";
import { cardDigits } from "../item-types.js";
import type { StoredPasskey } from "../passkey/authenticator.js";
import { fromBase64Url, toBase64Url } from "../passkey/base64url.js";
import { registrableDomain, type ItemDraft } from "../vault.js";
import {
  cardExpiry,
  countSkip,
  firstTotp,
  ImportError,
  joinNote,
  lines,
  list,
  object,
  text,
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

interface ExportKey {
  encryption: CryptoKey;
  mac: CryptoKey;
}

async function exportKey(passphrase: string, file: JsonObject): Promise<ExportKey> {
  if (file.kdfType === KDF_ARGON2ID) throw new ImportError("argon2");
  const iterations = file.kdfIterations;
  if (file.kdfType !== KDF_PBKDF2 || typeof iterations !== "number" || iterations < 1) {
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
  if (!value.startsWith(ENC_AES_CBC_HMAC)) throw new ImportError("unsupported_encryption");
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
  if (!iv || !data || !mac) throw new ImportError("damaged");
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
  if (id.startsWith("b64.")) return fromBase64Url(id.slice(4));
  if (!GUID.test(id)) throw new Error("Unknown credential id format");
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
  if (credential.keyAlgorithm !== "ECDSA" || credential.keyCurve !== "P-256") return null;
  const rpId = text(credential.rpId);
  if (!rpId) return null;
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

function fieldLines(item: JsonObject): string {
  return lines(
    list(item.fields)
      .map(object)
      .filter((field) => field.type !== FIELD_LINKED)
      .map((field): [string, string] => [text(field.name), text(field.value)]),
  );
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
    username,
    password: text(login.password) || undefined,
    totp,
    passkey,
    note: joinNote([
      text(item.notes),
      uris.length > 1 && `Websites:\n${uris.slice(1).join("\n")}`,
      fieldLines(item),
      ...unreadable.map((uri) => `2FA: ${uri}`),
    ]),
    createdAt: seconds(item.creationDate),
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
    note: joinNote([text(item.notes), lines([["Brand", text(card.brand)]]), fieldLines(item)]),
    createdAt: seconds(item.creationDate),
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
    note: joinNote([
      text(item.notes),
      lines([
        ["Title", field("title")],
        ["Username", field("username")],
        ["Social security number", field("ssn")],
        ["Passport number", field("passportNumber")],
        ["License number", field("licenseNumber")],
      ]),
      fieldLines(item),
    ]),
    createdAt: seconds(item.creationDate),
  };
}

function noteDraft(item: JsonObject, extra = ""): ItemDraft {
  return {
    type: "note",
    title: text(item.name) || "Note",
    note: joinNote([text(item.notes), extra, fieldLines(item)]),
    createdAt: seconds(item.creationDate),
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
        source.drafts.push(noteDraft(item));
        break;
      case CARD:
        source.drafts.push(cardDraft(item));
        break;
      case IDENTITY:
        source.drafts.push(identityDraft(item));
        break;
      case SSH_KEY: {
        const key = object(item.sshKey);
        source.drafts.push(
          noteDraft(
            item,
            lines([
              ["Public key", text(key.publicKey)],
              ["Fingerprint", text(key.keyFingerprint)],
              ["Private key", text(key.privateKey)],
            ]),
          ),
        );
        break;
      }
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
    if (!passphrase) throw new ImportError("needs_passphrase");
    const key = await exportKey(passphrase, parsed);
    await decryptEncString(text(parsed.encKeyValidation_DO_NOT_EDIT), key);
    let inner: JsonObject;
    try {
      inner = object(JSON.parse(await decryptEncString(text(parsed.data), key)));
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError("damaged");
    }
    return bitwardenFromJson(inner, undefined);
  }
  if (parsed.encrypted === true) throw new ImportError("account_encrypted");
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
