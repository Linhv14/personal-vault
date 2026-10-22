import type { StoredPasskey } from "../passkey/authenticator.js";
import { fromBase64, toBase64Url } from "#core/bytes.js";
import { decodeMsgpack, type MsgpackValue } from "./msgpack.js";

const P256 = 1;
const COSE_CURVE = -1;
const COSE_X = -2;
const COSE_Y = -3;
const COSE_D = -4;

export interface ProtonPasskeyFields {
  content: string;
  userName?: string;
  userDisplayName?: string;
  createTime?: number;
}

function bytes(value: MsgpackValue | undefined): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value) && value.every((byte) => typeof byte === "number")) {
    return Uint8Array.from(value);
  }
  return null;
}

function field(value: MsgpackValue | undefined, key: string): MsgpackValue | undefined {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
    ? value[key]
    : undefined;
}

function integer(value: MsgpackValue | undefined): number | null {
  if (typeof value === "number") {
    return value;
  }
  const littleEndian = bytes(field(value, "inner"));
  if (!littleEndian) {
    return null;
  }
  return littleEndian.reduceRight((total, byte) => total * 256 + byte, 0);
}

function coseParams(key: MsgpackValue | undefined): Map<number, MsgpackValue | undefined> {
  const params = new Map<number, MsgpackValue | undefined>();
  const list = field(key, "par");
  for (const pair of Array.isArray(list) ? list : []) {
    if (!Array.isArray(pair)) {
      continue;
    }
    const label = integer(field(pair[0], "c"));
    if (label !== null) {
      params.set(label, pair[1]);
    }
  }
  return params;
}

export async function readProtonPasskey(input: ProtonPasskeyFields): Promise<StoredPasskey | null> {
  try {
    const envelope = decodeMsgpack(fromBase64(input.content));
    const inner = bytes(field(envelope, "c"));
    if (field(envelope, "v") !== 1 || !inner) {
      return null;
    }
    const passkey = decodeMsgpack(inner);
    const key = field(passkey, "key");
    if (field(field(key, "kty"), "c") !== "EC2") {
      return null;
    }

    const params = coseParams(key);
    const curve = integer(field(params.get(COSE_CURVE), "c"));
    const [x, y, d] = [COSE_X, COSE_Y, COSE_D].map((label) => bytes(field(params.get(label), "c")));
    const credentialId = bytes(field(passkey, "cid"));
    const rpId = field(passkey, "rid");
    if (curve !== P256 || !x || !y || !d || !credentialId || typeof rpId !== "string") {
      return null;
    }

    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: toBase64Url(x),
        y: toBase64Url(y),
        d: toBase64Url(d),
        ext: true,
      },
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    const userHandle = bytes(field(passkey, "uhd"));
    const storedName = field(passkey, "un");
    const storedDisplayName = field(passkey, "udn");
    return {
      credentialId: toBase64Url(credentialId),
      rpId,
      userHandle: userHandle ? toBase64Url(userHandle) : "",
      userName: input.userName || (typeof storedName === "string" ? storedName : ""),
      userDisplayName:
        input.userDisplayName ||
        (typeof storedDisplayName === "string" ? storedDisplayName : undefined),
      privateKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey))),
      createdAt: input.createTime ?? Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}
