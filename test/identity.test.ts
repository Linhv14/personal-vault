import { describe, expect, it } from "vitest";
import { utf8Encode } from "../src/core/bytes.js";
import {
  createIdentity,
  fingerprint,
  isPublicKey,
  randomKey,
  unwrapForRecipient,
  wrapForRecipient,
} from "../src/core/identity.js";

const CONTEXT = utf8Encode("personal-vault/team-key/team-1");

describe("identity key pairs", () => {
  it("wraps a key that only the recipient can unwrap", async () => {
    const alice = await createIdentity();
    const mallory = await createIdentity();
    const teamKey = randomKey();
    const wrapped = await wrapForRecipient(alice.publicKey, teamKey, CONTEXT);

    expect(JSON.stringify(wrapped)).not.toContain(Buffer.from(teamKey).toString("base64"));
    expect(await unwrapForRecipient(alice, wrapped, CONTEXT)).toEqual(teamKey);
    await expect(unwrapForRecipient(mallory, wrapped, CONTEXT)).rejects.toThrow();
  });

  it("binds the wrap to its context and to the recipient's public key", async () => {
    const alice = await createIdentity();
    const other = await createIdentity();
    const wrapped = await wrapForRecipient(alice.publicKey, randomKey(), CONTEXT);
    await expect(
      unwrapForRecipient(alice, wrapped, utf8Encode("personal-vault/team-key/team-2")),
    ).rejects.toThrow();
    await expect(
      unwrapForRecipient({ ...alice, publicKey: other.publicKey }, wrapped, CONTEXT),
    ).rejects.toThrow();
  });

  it("uses a fresh ephemeral key every time", async () => {
    const alice = await createIdentity();
    const key = randomKey();
    const first = await wrapForRecipient(alice.publicKey, key, CONTEXT);
    const second = await wrapForRecipient(alice.publicKey, key, CONTEXT);
    expect(first.ephemeralPublicKey).not.toBe(second.ephemeralPublicKey);
  });

  it("gives a stable, readable fingerprint", async () => {
    const alice = await createIdentity();
    const print = await fingerprint(alice.publicKey);
    expect(print).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
    expect(await fingerprint(alice.publicKey)).toBe(print);
    expect(await fingerprint((await createIdentity()).publicKey)).not.toBe(print);
  });

  it("accepts only plausible public keys", async () => {
    expect(isPublicKey((await createIdentity()).publicKey)).toBe(true);
    for (const value of ["", "not base64!", "A".repeat(400), 42, null]) {
      expect(isPublicKey(value)).toBe(false);
    }
  });
});
