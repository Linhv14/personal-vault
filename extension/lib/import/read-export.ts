import { parseRecoveryCodes, titleFromFileName } from "../recovery-codes.js";
import {
  bitwardenFromCsv,
  bitwardenFromJson,
  isBitwardenCsv,
  isBitwardenJson,
} from "./bitwarden.js";
import { parseCsv } from "./csv.js";
import { genericCsv, isGenericCsv } from "./generic-csv.js";
import { isOnePasswordExport, onePasswordFromExport } from "./onepassword.js";
import {
  decryptProtonPgp,
  isProtonCsv,
  isProtonJson,
  protonFromCsv,
  protonFromJson,
} from "./protonpass.js";
import { ImportError, object, type ImportSource, type JsonObject } from "./source.js";
import { readZip, ZipError, type ZipEntry } from "./zip.js";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
  passphrase?: string;
  recoveryTitle: string;
}

function isZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  try {
    return readZip(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw new ImportError("damaged");
    throw error;
  }
}

function parseJson(content: string): JsonObject {
  try {
    return object(JSON.parse(content));
  } catch {
    throw new ImportError("damaged");
  }
}

async function fromJson(parsed: JsonObject, passphrase?: string): Promise<ImportSource> {
  if (isProtonJson(parsed)) return protonFromJson(parsed);
  if (isBitwardenJson(parsed)) return bitwardenFromJson(parsed, passphrase);
  if (isOnePasswordExport(parsed)) return onePasswordFromExport(parsed);
  throw new ImportError("unrecognized");
}

async function fromZip(file: ExportFile): Promise<ImportSource> {
  const entries = zipEntries(file.bytes);
  const read = async (suffix: string) => {
    const entry = entries.find((candidate) => candidate.name.endsWith(suffix));
    return entry ? new TextDecoder().decode(await entry.read()) : null;
  };
  const pgp = entries.find((entry) => entry.name.endsWith("data.pgp"));
  if (pgp)
    return protonFromJson(parseJson(await decryptProtonPgp(await pgp.read(), file.passphrase)));
  const json = (await read("export.data")) ?? (await read("data.json"));
  if (json === null) throw new ImportError("unrecognized");
  return fromJson(parseJson(json), file.passphrase);
}

function fromCsv(content: string): Promise<ImportSource> | null {
  const [header = [], ...rows] = parseCsv(content);
  const columns = header.map((name) => name.trim().toLowerCase());
  const records = rows.map((cells) =>
    Object.fromEntries(columns.map((name, index) => [name, cells[index] ?? ""])),
  );
  if (isProtonCsv(columns)) return protonFromCsv(records);
  if (isBitwardenCsv(columns)) return bitwardenFromCsv(records);
  if (isGenericCsv(columns)) return Promise.resolve(genericCsv(columns, records));
  return null;
}

function fromRecoveryCodes(file: ExportFile, content: string): ImportSource {
  const codes = parseRecoveryCodes(content);
  if (codes.length === 0) throw new ImportError("unrecognized");
  return {
    format: "recovery",
    drafts: [
      { type: "recovery", title: titleFromFileName(file.name) || file.recoveryTitle, codes },
    ],
    skipped: {},
  };
}

export async function readExport(file: ExportFile): Promise<ImportSource> {
  if (isZip(file.bytes)) return fromZip(file);
  const content = new TextDecoder().decode(file.bytes).replace(/^﻿/, "").trim();
  if (content.startsWith("-----BEGIN PGP")) {
    return protonFromJson(parseJson(await decryptProtonPgp(file.bytes, file.passphrase)));
  }
  if (content.startsWith("{")) return fromJson(parseJson(content), file.passphrase);
  return (await fromCsv(content)) ?? fromRecoveryCodes(file, content);
}
