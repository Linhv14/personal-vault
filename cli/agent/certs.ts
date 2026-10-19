import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

type Der = Buffer;

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, value: Buffer): Der {
  return Buffer.concat([Buffer.from([tag]), length(value.length), value]);
}

const sequence = (...items: Der[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Der[]) => tlv(0x31, Buffer.concat(items));
const explicit = (index: number, value: Der) => tlv(0xa0 + index, value);
const octets = (value: Buffer) => tlv(0x04, value);
const bits = (value: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), value]));
const utf8 = (value: string) => tlv(0x0c, Buffer.from(value, "utf8"));
const bool = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0]));

function integer(value: Buffer): Der {
  const trimmed = value[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return tlv(0x02, trimmed);
}

function oid(dotted: string): Der {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function time(date: Date): Der {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  return tlv(0x17, Buffer.from(text, "ascii"));
}

const ECDSA_SHA256 = sequence(oid("1.2.840.10045.4.3.2"));

const name = (common: string) => sequence(set(sequence(oid("2.5.4.3"), utf8(common))));

function extension(id: string, critical: boolean, value: Der): Der {
  return sequence(oid(id), ...(critical ? [bool(true)] : []), octets(value));
}

function keyId(publicKey: KeyObject): Buffer {
  const spki = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha1")
    .update(spki.subarray(spki.length - 65))
    .digest();
}

export interface Issued {
  cert: string;
  key: string;
}

export interface Authority extends Issued {
  issue(hostname: string): Issued;
}

interface Template {
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  signer: KeyObject;
  issuerKeyId: Buffer;
  extensions: Der[];
  days: number;
}

function certificate(template: Template): string {
  const notBefore = new Date(Date.now() - 60 * 60 * 1000);
  const notAfter = new Date(Date.now() + template.days * 24 * 60 * 60 * 1000);
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    ECDSA_SHA256,
    name(template.issuer),
    sequence(time(notBefore), time(notAfter)),
    name(template.subject),
    template.publicKey.export({ type: "spki", format: "der" }),
    explicit(
      3,
      sequence(
        ...template.extensions,
        extension("2.5.29.14", false, octets(keyId(template.publicKey))),
        extension("2.5.29.35", false, sequence(tlv(0x80, template.issuerKeyId))),
      ),
    ),
  );
  const signature = sign("sha256", tbs, { key: template.signer, dsaEncoding: "der" });
  const der = sequence(tbs, ECDSA_SHA256, bits(signature));
  const body = der.toString("base64").replace(/.{64}/g, "$&\n");
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

const KEY_USAGE_CA = Buffer.from([0x03, 0x02, 0x01, 0x06]);
const KEY_USAGE_SERVER = Buffer.from([0x03, 0x02, 0x07, 0x80]);

export function createAuthority(label = "7key agent session"): Authority {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const authorityKeyId = keyId(pair.publicKey);
  const cert = certificate({
    subject: label,
    issuer: label,
    publicKey: pair.publicKey,
    signer: pair.privateKey,
    issuerKeyId: authorityKeyId,
    days: 2,
    extensions: [
      extension("2.5.29.19", true, sequence(bool(true), integer(Buffer.from([0])))),
      extension("2.5.29.15", true, KEY_USAGE_CA),
    ],
  });
  const leaf = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const leafKey = leaf.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const issued = new Map<string, Issued>();
  return {
    cert,
    key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    issue(hostname) {
      const known = issued.get(hostname);
      if (known) return known;
      const result = {
        key: leafKey,
        cert: certificate({
          subject: hostname,
          issuer: label,
          publicKey: leaf.publicKey,
          signer: pair.privateKey,
          issuerKeyId: authorityKeyId,
          days: 1,
          extensions: [
            extension("2.5.29.19", true, sequence()),
            extension("2.5.29.15", true, KEY_USAGE_SERVER),
            extension("2.5.29.37", false, sequence(oid("1.3.6.1.5.5.7.3.1"))),
            extension("2.5.29.17", false, sequence(tlv(0x82, Buffer.from(hostname, "ascii")))),
          ],
        }),
      };
      issued.set(hostname, result);
      return result;
    },
  };
}

export function verifies(cert: string, authority: string): boolean {
  return new X509Certificate(cert).verify(new X509Certificate(authority).publicKey);
}
