import { fromBase64 } from "#core/bytes.js";

export type OpenPgpErrorCode = "wrong_passphrase" | "unsupported" | "damaged";

export class OpenPgpError extends Error {
  constructor(readonly code: OpenPgpErrorCode) {
    super(code);
    this.name = "OpenPgpError";
  }
}

const BLOCK = 16;
const TAG_SKESK = 3;
const TAG_COMPRESSED = 8;
const TAG_SEIPD = 18;
const TAG_LITERAL = 11;
const TAG_MDC = 19;
const AES_KEY_BYTES: Record<number, number> = { 7: 16, 8: 24, 9: 32 };
const S2K_HASHES: Record<number, string> = { 2: "SHA-1", 8: "SHA-256", 10: "SHA-512" };
const COMPRESSION: Record<number, CompressionFormat | null> = {
  0: null,
  1: "deflate-raw",
  2: "deflate",
};

interface Packet {
  tag: number;
  body: Uint8Array;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function dearmor(input: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(input);
  if (!text.startsWith("-----BEGIN PGP MESSAGE-----")) {
    return input;
  }
  const body = text.split(/\r?\n\r?\n/, 2)[1]?.split("-----END PGP MESSAGE-----")[0];
  if (!body) {
    throw new OpenPgpError("damaged");
  }
  const base64 = body
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("="))
    .join("");
  return fromBase64(base64);
}

function readPackets(data: Uint8Array): Packet[] {
  const packets: Packet[] = [];
  let offset = 0;
  const byte = () => {
    if (offset >= data.length) {
      throw new OpenPgpError("damaged");
    }
    return data[offset++] ?? 0;
  };
  const take = (length: number) => {
    if (offset + length > data.length) {
      throw new OpenPgpError("damaged");
    }
    const part = data.subarray(offset, offset + length);
    offset += length;
    return part;
  };

  while (offset < data.length) {
    const header = byte();
    if (!(header & 0x80)) {
      throw new OpenPgpError("damaged");
    }
    if (!(header & 0x40)) {
      const lengthType = header & 0x03;
      const size = [1, 2, 4][lengthType];
      if (!size) {
        throw new OpenPgpError("unsupported");
      }
      let length = 0;
      for (let index = 0; index < size; index++) {
        length = length * 256 + byte();
      }
      packets.push({ tag: (header >> 2) & 0x0f, body: take(length) });
      continue;
    }
    const tag = header & 0x3f;
    const parts: Uint8Array[] = [];
    for (;;) {
      const first = byte();
      if (first < 192) {
        parts.push(take(first));
        break;
      }
      if (first < 224) {
        parts.push(take(((first - 192) << 8) + byte() + 192));
        break;
      }
      if (first === 255) {
        parts.push(take(((byte() << 24) >>> 0) + (byte() << 16) + (byte() << 8) + byte()));
        break;
      }
      parts.push(take(1 << (first & 0x1f)));
    }
    packets.push({ tag, body: concat(parts) });
  }
  return packets;
}

async function digest(hash: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(hash, data));
}

async function stringToKey(
  passphrase: string,
  spec: Uint8Array,
  keyBytes: number,
): Promise<{ key: Uint8Array; length: number }> {
  const type = spec[0];
  const hash = S2K_HASHES[spec[1] ?? -1];
  if (!hash || (type !== 0 && type !== 1 && type !== 3)) {
    throw new OpenPgpError("unsupported");
  }
  const salt = type === 0 ? new Uint8Array(0) : spec.subarray(2, 10);
  const material = concat([salt, new TextEncoder().encode(passphrase)]);
  let input = material;
  if (type === 3) {
    const coded = spec[10] ?? 0;
    const count = Math.max((16 + (coded & 15)) << ((coded >> 4) + 6), material.length);
    input = new Uint8Array(count);
    for (let offset = 0; offset < count; offset += material.length) {
      input.set(material.subarray(0, Math.min(material.length, count - offset)), offset);
    }
  }
  const parts: Uint8Array[] = [];
  for (let round = 0; parts.reduce((sum, part) => sum + part.length, 0) < keyBytes; round++) {
    parts.push(await digest(hash, concat([new Uint8Array(round), input])));
  }
  return { key: concat(parts).slice(0, keyBytes), length: type === 3 ? 11 : type === 1 ? 10 : 2 };
}

async function cfbDecrypt(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-CBC", false, [
    "encrypt",
  ]);
  const zeroIv = new Uint8Array(BLOCK);
  const encryptBlock = async (block: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-CBC", iv: zeroIv }, key, new Uint8Array(block)),
    ).subarray(0, BLOCK);

  const blocks = Math.ceil(data.length / BLOCK);
  const feedback = Array.from({ length: blocks }, (_, index) =>
    index === 0 ? zeroIv : data.subarray((index - 1) * BLOCK, index * BLOCK),
  );
  const keystream: Uint8Array[] = [];
  for (let start = 0; start < feedback.length; start += 1024) {
    keystream.push(...(await Promise.all(feedback.slice(start, start + 1024).map(encryptBlock))));
  }
  const stream = concat(keystream);
  const out = new Uint8Array(data.length);
  data.forEach((value, index) => {
    out[index] = value ^ (stream[index] ?? 0);
  });
  return out;
}

async function sessionKey(
  skesk: Uint8Array,
  passphrase: string,
): Promise<{ algorithm: number; key: Uint8Array }> {
  if (skesk[0] !== 4) {
    throw new OpenPgpError("unsupported");
  }
  const algorithm = skesk[1] ?? -1;
  const keyBytes = AES_KEY_BYTES[algorithm];
  if (!keyBytes) {
    throw new OpenPgpError("unsupported");
  }
  const { key, length } = await stringToKey(passphrase, skesk.subarray(2), keyBytes);
  const encrypted = skesk.subarray(2 + length);
  if (encrypted.length === 0) {
    return { algorithm, key };
  }

  const decrypted = await cfbDecrypt(key, encrypted);
  const inner = decrypted[0] ?? -1;
  const innerBytes = AES_KEY_BYTES[inner];
  if (!innerBytes || decrypted.length !== innerBytes + 1) {
    throw new OpenPgpError("wrong_passphrase");
  }
  return { algorithm: inner, key: decrypted.subarray(1) };
}

async function decompress(body: Uint8Array): Promise<Uint8Array> {
  const format = COMPRESSION[body[0] ?? -1];
  if (format === undefined) {
    throw new OpenPgpError("unsupported");
  }
  if (format === null) {
    return body.subarray(1);
  }
  const stream = new Blob([new Uint8Array(body.subarray(1))])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function literalData(packets: Packet[]): Promise<Uint8Array> {
  for (const packet of packets) {
    if (packet.tag === TAG_COMPRESSED) {
      return literalData(readPackets(await decompress(packet.body)));
    }
    if (packet.tag === TAG_LITERAL) {
      const nameLength = packet.body[1] ?? 0;
      return packet.body.subarray(2 + nameLength + 4);
    }
  }
  throw new OpenPgpError("damaged");
}

export async function decryptWithPassphrase(
  message: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  const packets = readPackets(dearmor(message));
  const skesk = packets.find((packet) => packet.tag === TAG_SKESK);
  const seipd = packets.find((packet) => packet.tag === TAG_SEIPD);
  if (!skesk || !seipd) {
    throw new OpenPgpError("unsupported");
  }
  if (seipd.body[0] !== 1) {
    throw new OpenPgpError("unsupported");
  }

  const { key } = await sessionKey(skesk.body, passphrase);
  const plain = await cfbDecrypt(key, seipd.body.subarray(1));
  if (plain[BLOCK - 2] !== plain[BLOCK] || plain[BLOCK - 1] !== plain[BLOCK + 1]) {
    throw new OpenPgpError("wrong_passphrase");
  }

  const mdcStart = plain.length - 22;
  if (mdcStart < BLOCK + 2 || plain[mdcStart] !== 0xc0 + TAG_MDC || plain[mdcStart + 1] !== 20) {
    throw new OpenPgpError("damaged");
  }
  const expected = await digest("SHA-1", new Uint8Array(plain.subarray(0, mdcStart + 2)));
  const actual = plain.subarray(mdcStart + 2);
  if (expected.some((value, index) => value !== actual[index])) {
    throw new OpenPgpError("wrong_passphrase");
  }
  return literalData(readPackets(plain.subarray(BLOCK + 2, mdcStart)));
}
