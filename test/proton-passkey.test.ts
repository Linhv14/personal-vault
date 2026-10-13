import { describe, expect, it } from "vitest";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { decodeMsgpack } from "../extension/lib/import/msgpack.js";
import { planImport } from "../extension/lib/import/plan.js";
import { readExport } from "../extension/lib/import/read-export.js";
import { readProtonPasskey } from "../extension/lib/import/proton-passkey.js";
import { signAssertion } from "../extension/lib/passkey/authenticator.js";
import { fromBase64Url, toBase64Url } from "../extension/lib/passkey/base64url.js";
import type { VaultItem } from "../extension/lib/vault.js";

type Packable = null | number | string | Uint8Array | Packable[] | { [key: string]: Packable };

function pack(value: Packable): number[] {
  if (value === null) return [0xc0];
  if (typeof value === "number") {
    if (value >= 0 && value < 128) return [value];
    if (value < 0 && value >= -32) return [0x100 + value];
    const out = new DataView(new ArrayBuffer(5));
    out.setUint8(0, 0xd2);
    out.setInt32(1, value);
    return [...new Uint8Array(out.buffer)];
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return [0xd9, bytes.length, ...bytes];
  }
  if (value instanceof Uint8Array) return [0xc5, value.length >> 8, value.length & 0xff, ...value];
  if (Array.isArray(value))
    return [0xdc, value.length >> 8, value.length & 0xff, ...value.flatMap(pack)];
  const entries = Object.entries(value);
  return [
    0xde,
    entries.length >> 8,
    entries.length & 0xff,
    ...entries.flatMap(([k, v]) => [...pack(k), ...pack(v)]),
  ];
}

const asNumbers = (bytes: Uint8Array): Packable[] => [...bytes];
const i128 = (value: number): Packable => ({
  inner: asNumbers(new Uint8Array([value, ...Array(15).fill(0)])),
});

async function protonPasskeyContent(rpId: string, credentialId: Uint8Array) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const passkey = {
    key: {
      kty: { t: "assign", c: "EC2" },
      kid: [],
      alg: { t: "assign", c: "ES256" },
      kops: [],
      biv: [],
      par: [
        [
          { t: "int", c: -1 },
          { t: "int", c: i128(1) },
        ],
        [
          { t: "int", c: -2 },
          { t: "bytes", c: asNumbers(fromBase64Url(jwk.x!)) },
        ],
        [
          { t: "int", c: -3 },
          { t: "bytes", c: asNumbers(fromBase64Url(jwk.y!)) },
        ],
        [
          { t: "int", c: -4 },
          { t: "bytes", c: asNumbers(fromBase64Url(jwk.d!)) },
        ],
      ],
    },
    cid: asNumbers(credentialId),
    rid: rpId,
    uhd: asNumbers(new TextEncoder().encode("user-7")),
    cnt: null,
    un: "me@example.com",
  } satisfies Packable;
  const envelope = pack({ c: asNumbers(new Uint8Array(pack(passkey))), v: 1 });
  return { content: btoa(String.fromCharCode(...envelope)), publicKey: keys.publicKey, jwk };
}

function cosePublicKey(jwk: JsonWebKey): Uint8Array<ArrayBuffer> {
  const x = fromBase64Url(jwk.x!);
  const y = fromBase64Url(jwk.y!);
  return new Uint8Array([
    0xa5,
    0x01,
    0x02,
    0x03,
    0x26,
    0x20,
    0x01,
    0x21,
    0x58,
    0x20,
    ...x,
    0x22,
    0x58,
    0x20,
    ...y,
  ]);
}

describe("decodeMsgpack", () => {
  it("reads the types Proton uses", () => {
    expect(
      decodeMsgpack(new Uint8Array(pack({ a: [1, -5, "x", null], b: new Uint8Array([7]) }))),
    ).toEqual({
      a: [1, -5, "x", null],
      b: new Uint8Array([7]),
    });
  });

  it("rejects truncated data", () => {
    expect(() => decodeMsgpack(new Uint8Array([0x92, 0x01]))).toThrow();
  });
});

describe("Proton Pass passkeys", () => {
  it("turns an exported passkey into one that signs for the same site", async () => {
    const credentialId = crypto.getRandomValues(new Uint8Array(16));
    const { content, jwk } = await protonPasskeyContent("example.com", credentialId);
    const passkey = await readProtonPasskey({ content, userName: "me@example.com" });
    expect(passkey).toMatchObject({
      rpId: "example.com",
      credentialId: toBase64Url(credentialId),
      userHandle: toBase64Url(new TextEncoder().encode("user-7")),
      userName: "me@example.com",
    });

    const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const assertion = await signAssertion(passkey!, { origin: "https://example.com", challenge });
    const verification = await verifyAuthenticationResponse({
      response: {
        id: assertion.credentialId,
        rawId: assertion.credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: assertion.clientDataJSON,
          authenticatorData: assertion.authenticatorData,
          signature: assertion.signature,
          userHandle: assertion.userHandle,
        },
      },
      expectedChallenge: challenge,
      expectedOrigin: "https://example.com",
      expectedRPID: "example.com",
      credential: { id: assertion.credentialId, publicKey: cosePublicKey(jwk), counter: 0 },
    });
    expect(verification.verified).toBe(true);
  });

  it("returns null for content it cannot read", async () => {
    expect(await readProtonPasskey({ content: btoa("not msgpack") })).toBeNull();
  });

  it("adds passkeys to logins already imported without them", async () => {
    const credentialId = crypto.getRandomValues(new Uint8Array(16));
    const { content } = await protonPasskeyContent("github.com", credentialId);
    const exported = JSON.stringify({
      encrypted: false,
      vaults: {
        a: {
          items: [
            {
              state: 1,
              data: {
                type: "login",
                metadata: { name: "GitHub", note: "" },
                extraFields: [],
                content: {
                  itemUsername: "octocat",
                  password: "hunter2",
                  urls: ["https://github.com"],
                  passkeys: [{ content, userName: "octocat" }, { content: btoa("broken") }],
                },
              },
            },
          ],
        },
      },
    });
    const existing = [
      {
        id: "1",
        title: "GitHub",
        url: "https://github.com",
        username: "octocat",
        password: "hunter2",
      },
    ] as VaultItem[];
    const entries = await readExport({
      name: "data.json",
      bytes: new TextEncoder().encode(exported),
      recoveryTitle: "Recovery codes",
    });

    const plan = planImport(entries, existing);
    expect(plan.items).toEqual([]);
    expect(plan.passkeysForExisting).toHaveLength(1);
    expect(plan.passkeysForExisting[0]).toMatchObject({ id: "1", passkey: { rpId: "github.com" } });
    expect(plan.skipped).toEqual({ passkey: 1 });

    const again = planImport(entries, plan.passkeysForExisting);
    expect(again.passkeysForExisting).toEqual([]);
    expect(again.skipped.duplicate).toBe(1);
  });
});
