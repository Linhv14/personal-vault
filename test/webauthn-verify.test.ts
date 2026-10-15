import { describe, expect, it } from "vitest";
import { toBase64Url } from "../src/core/bytes.js";
import { createPasskey, signAssertion } from "../extension/lib/passkey/authenticator.js";
import { RS256, verifyAssertion } from "../src/worker/webauthn.js";

const ORIGIN = "chrome-extension://eepgmbamigmadeddhcoldncaolikeagm";
const RP_ID = "eepgmbamigmadeddhcoldncaolikeagm";
const CHALLENGE = toBase64Url(new Uint8Array(32).fill(5));

async function setUp() {
  const { registration, passkey } = await createPasskey({
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: CHALLENGE,
    userHandle: "dXNlcg",
    userName: "me@example.com",
  });
  const assertion = await signAssertion(passkey, { origin: ORIGIN, challenge: CHALLENGE });
  const expected = {
    publicKey: registration.publicKey,
    algorithm: registration.publicKeyAlgorithm,
    rpId: RP_ID,
    origin: ORIGIN,
    challenge: CHALLENGE,
  };
  return { expected, assertion, passkey };
}

function flip(base64url: string, index: number): string {
  const bytes = Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  bytes[index] = (bytes[index] ?? 0) ^ 1;
  return toBase64Url(bytes);
}

describe("verifyAssertion", () => {
  it("accepts a fresh ES256 assertion from the registered key", async () => {
    const { expected, assertion } = await setUp();
    expect(await verifyAssertion(expected, assertion)).toBe(true);
  });

  it("refuses another challenge, origin, RP ID or key", async () => {
    const { expected, assertion } = await setUp();
    const other = await setUp();
    expect(
      await verifyAssertion({ ...expected, challenge: toBase64Url(new Uint8Array(32)) }, assertion),
    ).toBe(false);
    expect(await verifyAssertion({ ...expected, origin: "https://evil.example" }, assertion)).toBe(
      false,
    );
    expect(await verifyAssertion({ ...expected, rpId: "evil.example" }, assertion)).toBe(false);
    expect(
      await verifyAssertion({ ...expected, publicKey: other.expected.publicKey }, assertion),
    ).toBe(false);
  });

  it("refuses tampered data, a forged signature and garbage", async () => {
    const { expected, assertion } = await setUp();
    expect(
      await verifyAssertion(expected, {
        ...assertion,
        authenticatorData: flip(assertion.authenticatorData, 10),
      }),
    ).toBe(false);
    expect(
      await verifyAssertion(expected, { ...assertion, signature: flip(assertion.signature, 20) }),
    ).toBe(false);
    expect(await verifyAssertion(expected, { ...assertion, clientDataJSON: "bm90IGpzb24" })).toBe(
      false,
    );
    expect(await verifyAssertion(expected, { ...assertion, signature: "" })).toBe(false);
  });

  it("requires user verification", async () => {
    const { expected, assertion } = await setUp();
    const authData = Uint8Array.from(
      atob(assertion.authenticatorData.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    authData[32] = 0x01;
    expect(
      await verifyAssertion(expected, { ...assertion, authenticatorData: toBase64Url(authData) }),
    ).toBe(false);
  });

  it("verifies RS256, as Windows Hello often uses", async () => {
    const keys = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const { assertion } = await setUp();
    const authData = Uint8Array.from(
      atob(assertion.authenticatorData.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const clientData = Uint8Array.from(
      atob(assertion.clientDataJSON.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
    const signed = new Uint8Array([...authData, ...hash]);
    const signature = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, signed),
    );
    const publicKey = toBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)),
    );
    const expected = {
      publicKey,
      algorithm: RS256,
      rpId: RP_ID,
      origin: ORIGIN,
      challenge: CHALLENGE,
    };
    expect(
      await verifyAssertion(expected, { ...assertion, signature: toBase64Url(signature) }),
    ).toBe(true);
    expect(
      await verifyAssertion(
        { ...expected, algorithm: -8 },
        { ...assertion, signature: toBase64Url(signature) },
      ),
    ).toBe(false);
  });
});
