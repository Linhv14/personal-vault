import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const LICENSE_PREFIX = "7key-license-v1";

export interface LicenseTerms {
  licensee: string;
  seats: number;
  expiresAt: number;
  features: string[];
}

export function publicKeyOf(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new Error("The signing key must be an Ed25519 private key");
  }
  return jwk.x;
}

export function signLicense(privateKeyPem: string, terms: LicenseTerms): string {
  const key = createPrivateKey(privateKeyPem);
  publicKeyOf(key);
  const payload = Buffer.from(JSON.stringify(terms)).toString("base64url");
  const signed = `${LICENSE_PREFIX}.${payload}`;
  const signature = sign(null, Buffer.from(signed), key).toString("base64url");
  return `${signed}.${signature}`;
}

function readSigningKey(): string {
  const inline = process.env.LICENSE_SIGNING_KEY;
  if (inline) {
    return inline;
  }
  const file = process.env.LICENSE_SIGNING_KEY_FILE;
  if (file) {
    return readFileSync(file, "utf8");
  }
  throw new Error("Set LICENSE_SIGNING_KEY_FILE to the private key file, or LICENSE_SIGNING_KEY");
}

function keygen(out: string | undefined): void {
  if (!out) {
    throw new Error("Usage: issue-license.ts keygen --out <private-key.pem>");
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  writeFileSync(out, pem, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Private key written to ${out}. Keep it out of the repository.\n`);
  process.stdout.write(
    `Public key for commercial/core/license-key.ts:\n${publicKeyOf(privateKey)}\n`,
  );
}

function issue(values: Record<string, string | undefined>): void {
  const licensee = values.licensee?.trim();
  const seats = Number(values.seats);
  const expiry = Date.parse(values.expires ?? "");
  const features = (values.features ?? "sso")
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (!licensee || !Number.isSafeInteger(seats) || seats < 1 || Number.isNaN(expiry)) {
    throw new Error(
      "Usage: issue-license.ts issue --licensee <name> --seats <n> --expires <YYYY-MM-DD> [--features sso]",
    );
  }
  const terms = { licensee, seats, expiresAt: Math.floor(expiry / 1000), features };
  process.stdout.write(`${signLicense(readSigningKey(), terms)}\n`);
}

function main(): void {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      licensee: { type: "string" },
      seats: { type: "string" },
      expires: { type: "string" },
      features: { type: "string" },
    },
  });
  const command = positionals[0];
  if (command === "keygen") {
    keygen(values.out);
  } else if (command === "issue") {
    issue(values);
  } else {
    throw new Error("Usage: issue-license.ts keygen --out <file> | issue --licensee ...");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
