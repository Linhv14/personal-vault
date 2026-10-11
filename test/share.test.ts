import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  createShare,
  fragmentNeedsPassphrase,
  openShare,
  type SharePayload,
} from "../src/core/share.js";
import { fromBase64, fromBase64Url, toBase64 } from "../src/core/bytes.js";
import { expectCodeAsync } from "./helpers.js";

const PAYLOAD: SharePayload = {
  title: "Family streaming account",
  username: "family@example.com",
  password: "a long shared password",
  note: "Use the second profile.",
  totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 30 },
};

describe("createShare / openShare", () => {
  it("round-trips the whole payload", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(fragment, sealed)).toEqual(PAYLOAD);
  });

  it("uses a fresh 32-byte key per share", async () => {
    const a = await createShare(PAYLOAD);
    const b = await createShare(PAYLOAD);
    expect(fromBase64Url(a.fragment)).toHaveLength(32);
    expect(a.fragment).not.toBe(b.fragment);
    expect(a.sealed.ciphertext).not.toBe(b.sealed.ciphertext);
  });

  it("emits base64url, free of characters a URL would re-encode", async () => {
    // `+` and `/` from standard base64 get mangled in transit and corrupt the key.
    for (let i = 0; i < 50; i++) {
      const { fragment } = await createShare(PAYLOAD);
      expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("leaves no trace of the plaintext in the ciphertext", async () => {
    const { sealed } = await createShare(PAYLOAD);
    const raw = new TextDecoder("latin1").decode(fromBase64(sealed.ciphertext));
    expect(raw).not.toContain("Family");
    expect(raw).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("cannot be opened with another key", async () => {
    const { sealed } = await createShare(PAYLOAD);
    const other = await createShare(PAYLOAD);
    await expectCodeAsync(openShare(other.fragment, sealed), "share.undecryptable");
  });

  it("rejects keys of the wrong length or shape", async () => {
    const { sealed } = await createShare(PAYLOAD);
    await expectCodeAsync(openShare(toBase64(new Uint8Array(16)), sealed), "share.invalid_key");
    await expectCodeAsync(openShare("!!!not-base64!!!", sealed), "share.invalid_key");
  });

  it("accepts a fragment with its leading #, as location.hash provides it", async () => {
    // `location.hash` always includes the hash; forgetting to strip it would
    // make every link fail to decrypt.
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(`#${fragment}`, sealed)).toEqual(PAYLOAD);
  });
});

describe("extra passphrase", () => {
  it("needs both the link and the passphrase", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD, "coffee");
    expect(await openShare(fragment, sealed, "coffee")).toEqual(PAYLOAD);
  });

  it("refuses the right link with the wrong passphrase", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD, "coffee");
    await expectCodeAsync(openShare(fragment, sealed, "tea"), "share.wrong_passphrase");
  });

  it("announces that a passphrase is required instead of making the recipient guess", async () => {
    const withPass = await createShare(PAYLOAD, "secret");
    const without = await createShare(PAYLOAD);
    expect(fragmentNeedsPassphrase(withPass.fragment)).toBe(true);
    expect(fragmentNeedsPassphrase(`#${withPass.fragment}`)).toBe(true);
    expect(fragmentNeedsPassphrase(without.fragment)).toBe(false);
    await expectCodeAsync(
      openShare(withPass.fragment, withPass.sealed),
      "share.passphrase_required",
    );
  });

  it("ignores a passphrase on a link that does not use one", async () => {
    const { sealed, fragment } = await createShare(PAYLOAD);
    expect(await openShare(fragment, sealed, "ignored")).toEqual(PAYLOAD);
  });
});

describe("buildShareUrl", () => {
  it("builds /s/<id>#<fragment>", () => {
    expect(buildShareUrl("https://vault.example.com", "abc123", "KEY")).toBe(
      "https://vault.example.com/s/abc123#KEY",
    );
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(buildShareUrl("https://vault.example.com/", "abc", "K")).toBe(
      "https://vault.example.com/s/abc#K",
    );
  });
});
