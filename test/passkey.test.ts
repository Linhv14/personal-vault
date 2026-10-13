import { describe, expect, it } from "vitest";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { encodeCbor } from "../extension/lib/passkey/cbor.js";
import { createPasskey, signAssertion } from "../extension/lib/passkey/authenticator.js";
import { fromBase64Url, toBase64Url } from "../extension/lib/passkey/base64url.js";
import { resolveRpId } from "../extension/lib/passkey/relying-party.js";

const origin = "https://login.example.com";
const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

async function register(rpId = "example.com") {
  return createPasskey({
    rpId,
    origin,
    challenge,
    userHandle: toBase64Url(new TextEncoder().encode("user-42")),
    userName: "me@example.com",
  });
}

describe("encodeCbor", () => {
  it("matches RFC 8949 examples", () => {
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
    expect(hex(encodeCbor(0))).toBe("00");
    expect(hex(encodeCbor(23))).toBe("17");
    expect(hex(encodeCbor(24))).toBe("1818");
    expect(hex(encodeCbor(1000))).toBe("1903e8");
    expect(hex(encodeCbor(-1))).toBe("20");
    expect(hex(encodeCbor(-7))).toBe("26");
    expect(hex(encodeCbor("a"))).toBe("6161");
    expect(hex(encodeCbor(new Uint8Array([1, 2, 3])))).toBe("43010203");
    expect(hex(encodeCbor([1, [2, 3]]))).toBe("8201820203");
    expect(hex(encodeCbor(new Map([[1, 2]])))).toBe("a10102");
  });
});

function registrationResponse({ registration }: Awaited<ReturnType<typeof register>>) {
  return {
    id: registration.credentialId,
    rawId: registration.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: registration.clientDataJSON,
      attestationObject: registration.attestationObject,
    },
  };
}

async function verifyRegistration(created: Awaited<ReturnType<typeof register>>) {
  return verifyRegistrationResponse({
    response: registrationResponse(created),
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: "example.com",
    requireUserVerification: true,
  });
}

function assertionResponse(assertion: Awaited<ReturnType<typeof signAssertion>>) {
  return {
    id: assertion.credentialId,
    rawId: assertion.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: assertion.clientDataJSON,
      authenticatorData: assertion.authenticatorData,
      signature: assertion.signature,
      userHandle: assertion.userHandle,
    },
  };
}

describe("passkey authenticator", () => {
  it("produces a registration an independent WebAuthn server accepts", async () => {
    const created = await register();
    const verification = await verifyRegistration(created);
    expect(verification.verified).toBe(true);
    expect(verification.registrationInfo?.credentialBackedUp).toBe(true);
    expect(verification.registrationInfo?.credential.id).toBe(created.registration.credentialId);
  });

  it("signs assertions that verify against the registered public key", async () => {
    const created = await register();
    const { registrationInfo } = await verifyRegistration(created);
    const loginChallenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const assertion = await signAssertion(created.passkey, { origin, challenge: loginChallenge });

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse(assertion),
      expectedChallenge: loginChallenge,
      expectedOrigin: origin,
      expectedRPID: "example.com",
      requireUserVerification: true,
      credential: registrationInfo!.credential,
    });
    expect(verification.verified).toBe(true);
  });

  it("binds a signature to the origin it was made for", async () => {
    const created = await register();
    const { registrationInfo } = await verifyRegistration(created);
    const assertion = await signAssertion(created.passkey, {
      origin: "https://evil.example",
      challenge,
    });
    const clientData = JSON.parse(
      new TextDecoder().decode(fromBase64Url(assertion.clientDataJSON)),
    );
    expect(clientData.origin).toBe("https://evil.example");
    await expect(
      verifyAuthenticationResponse({
        response: assertionResponse(assertion),
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: "example.com",
        credential: registrationInfo!.credential,
      }),
    ).rejects.toThrow(/origin/i);
  });

  it("never puts the private key in what goes back to the page", async () => {
    const { registration, passkey } = await register();
    expect(JSON.stringify(registration)).not.toContain(passkey.privateKey);
  });
});

describe("resolveRpId", () => {
  it("defaults to the page's host", () => {
    expect(resolveRpId("https://login.example.com", undefined)).toBe("login.example.com");
  });

  it("allows the host or a parent up to the registrable domain", () => {
    expect(resolveRpId("https://login.example.com", "example.com")).toBe("example.com");
    expect(resolveRpId("https://a.b.example.co.uk", "example.co.uk")).toBe("example.co.uk");
  });

  it("refuses other sites, public suffixes and shared hosting neighbours", () => {
    expect(resolveRpId("https://login.example.com", "google.com")).toBeNull();
    expect(resolveRpId("https://evil-example.com", "example.com")).toBeNull();
    expect(resolveRpId("https://login.example.com", "com")).toBeNull();
    expect(resolveRpId("https://example.co.uk", "co.uk")).toBeNull();
    expect(resolveRpId("https://alice.github.io", "github.io")).toBeNull();
  });

  it("accepts an IP address only as itself", () => {
    expect(resolveRpId("https://127.0.0.1:8443", undefined)).toBe("127.0.0.1");
    expect(resolveRpId("https://127.0.0.1", "0.0.1")).toBeNull();
  });
});
