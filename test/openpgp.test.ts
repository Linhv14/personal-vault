import { describe, expect, it } from "vitest";
import * as openpgp from "openpgp";
import { decryptWithPassphrase, OpenPgpError } from "../extension/lib/import/openpgp.js";

const PLAINTEXT = JSON.stringify({
  vaults: { a: { items: Array(40).fill({ name: "ä ✓ 日本" }) } },
});

async function encrypt(options: {
  armor: boolean;
  compression?: openpgp.enums.compression;
  aead?: boolean;
  s2kCount?: number;
}) {
  const message = await openpgp.createMessage({ text: PLAINTEXT });
  const config = {
    aeadProtect: options.aead ?? false,
    preferredCompressionAlgorithm: options.compression ?? openpgp.enums.compression.uncompressed,
    s2kIterationCountByte: options.s2kCount ?? 255,
  };
  if (options.armor) {
    const armored = await openpgp.encrypt({ message, passwords: ["correct horse"], config });
    return new TextEncoder().encode(armored as string);
  }
  return (await openpgp.encrypt({
    message,
    passwords: ["correct horse"],
    format: "binary",
    config,
  })) as Uint8Array;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("decryptWithPassphrase", () => {
  it("opens an armored message like Proton Pass's encrypted export", async () => {
    expect(text(await decryptWithPassphrase(await encrypt({ armor: true }), "correct horse"))).toBe(
      PLAINTEXT,
    );
  });

  it.each([
    ["zip", openpgp.enums.compression.zip],
    ["zlib", openpgp.enums.compression.zlib],
  ])("handles %s compression and binary messages", async (_name, compression) => {
    const message = await encrypt({ armor: false, compression, s2kCount: 96 });
    expect(text(await decryptWithPassphrase(message, "correct horse"))).toBe(PLAINTEXT);
  });

  it("reports a wrong passphrase", async () => {
    await expect(decryptWithPassphrase(await encrypt({ armor: true }), "wrong")).rejects.toEqual(
      new OpenPgpError("wrong_passphrase"),
    );
  });

  it("refuses formats it does not implement instead of misreading them", async () => {
    await expect(
      decryptWithPassphrase(await encrypt({ armor: true, aead: true }), "correct horse"),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("rejects tampered ciphertext", async () => {
    const message = await encrypt({ armor: false });
    const position = message.length - 30;
    message.set([(message[position] ?? 0) ^ 0x01], position);
    await expect(decryptWithPassphrase(message, "correct horse")).rejects.toBeInstanceOf(
      OpenPgpError,
    );
  });
});
