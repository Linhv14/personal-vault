import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLink } from "../cli/account/link.js";
import { fileKeyring, loadLogin, saveLogin } from "../cli/account/credentials.js";
import { remembered } from "../cli/agent/config.js";
import { toBase64 } from "../src/core/bytes.js";
import { isCiResponse } from "../src/core/ci.js";
import { createVaultKey, importVaultKey, isSealedData, seal } from "../src/core/crypto.js";
import { isWrappedForRecipient } from "../src/core/identity.js";
import { isPlainObject, isStringArray, parseJsonAs } from "../src/core/json.js";
import { createShare, openShare, parseSharePayload } from "../src/core/share.js";
import { parseTotpConfig } from "../src/core/totp.js";
import { validJwks } from "../src/worker/github-oidc.js";
import { expectCodeAsync } from "./helpers.js";

const SEALED = { ciphertext: "AAAA", nonce: "BBBB" };
const WRAPPED = { ephemeralPublicKey: "CCCC", sealed: SEALED };

describe("plain JSON guards", () => {
  it("accepts only non-array objects as plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect([[], null, "x", 1, undefined].map(isPlainObject)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("checks every entry of a string array", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["a.com", "b.com"])).toBe(true);
    expect(isStringArray(["a.com", 1])).toBe(false);
    expect(isStringArray("a.com")).toBe(false);
  });

  it("parses JSON only when the guard accepts the shape", () => {
    expect(parseJsonAs('["example.com"]', isStringArray)).toEqual(["example.com"]);
    expect(() => parseJsonAs('{"0":"example.com"}', isStringArray)).toThrow(TypeError);
    expect(() => parseJsonAs("{oops", isStringArray)).toThrow(SyntaxError);
  });
});

describe("sealed and wrapped values", () => {
  it("accepts what the code writes, including extra fields", async () => {
    expect(
      isSealedData(await seal(await importVaultKey(createVaultKey()), new Uint8Array([1]))),
    ).toBe(true);
    expect(isSealedData({ ...SEALED, extra: 1 })).toBe(true);
    expect(isWrappedForRecipient(WRAPPED)).toBe(true);
  });

  it("rejects missing or mistyped fields", () => {
    expect(isSealedData({ ciphertext: "AAAA" })).toBe(false);
    expect(isSealedData({ ciphertext: 1, nonce: "BBBB" })).toBe(false);
    expect(isSealedData(null)).toBe(false);
    expect(isWrappedForRecipient({ ephemeralPublicKey: "CCCC" })).toBe(false);
    expect(isWrappedForRecipient({ ephemeralPublicKey: 1, sealed: SEALED })).toBe(false);
    expect(isWrappedForRecipient({ ephemeralPublicKey: "CCCC", sealed: { nonce: "x" } })).toBe(
      false,
    );
  });
});

describe("TOTP config parsing", () => {
  it("keeps a full config and fills defaults for missing parameters", () => {
    const full = { secret: "JBSWY3DP", algorithm: "SHA-256", digits: 8, period: 60, issuer: "X" };
    expect(parseTotpConfig(full)).toEqual(full);
    expect(parseTotpConfig({ secret: "JBSWY3DP" })).toEqual({
      secret: "JBSWY3DP",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });
  });

  it("rejects a config with a bad parameter", () => {
    expect(parseTotpConfig({ algorithm: "SHA-1" })).toBeNull();
    expect(parseTotpConfig({ secret: "JBSWY3DP", algorithm: "MD5" })).toBeNull();
    expect(parseTotpConfig({ secret: "JBSWY3DP", period: 0 })).toBeNull();
    expect(parseTotpConfig({ secret: "JBSWY3DP", digits: "6" })).toBeNull();
    expect(parseTotpConfig({ secret: "JBSWY3DP", issuer: 3 })).toBeNull();
    expect(parseTotpConfig("JBSWY3DP")).toBeNull();
  });
});

describe("share payload parsing", () => {
  const payload = {
    title: "Wi-Fi",
    url: "https://example.com",
    username: "me",
    password: "pw",
    note: "n",
    totp: { secret: "JBSWY3DP", algorithm: "SHA-1", digits: 6, period: 30 },
    fields: [
      { label: "PIN", value: "1234", hidden: true },
      { label: "Floor", value: "3" },
    ],
  };

  it("accepts every field the share screen writes", () => {
    expect(parseSharePayload(payload)).toEqual(payload);
    expect(parseSharePayload({})).toEqual({});
  });

  it("rejects mistyped fields", () => {
    expect(parseSharePayload({ title: 1 })).toBeNull();
    expect(parseSharePayload({ password: null })).toBeNull();
    expect(parseSharePayload({ totp: { digits: 6 } })).toBeNull();
    expect(parseSharePayload({ fields: {} })).toBeNull();
    expect(parseSharePayload({ fields: [{ label: "x" }] })).toBeNull();
    expect(parseSharePayload({ fields: [{ label: "x", value: "y", hidden: "yes" }] })).toBeNull();
    expect(parseSharePayload([payload])).toBeNull();
  });

  it("refuses to open a link whose payload has the wrong shape", async () => {
    const { sealed, fragment } = await createShare({ title: 42 } as never);
    await expectCodeAsync(openShare(fragment, sealed), "share.undecryptable");
  });
});

describe("CI response guard", () => {
  const response = {
    projectId: "p",
    environmentId: "e",
    generation: 1,
    wrappedKey: WRAPPED,
    secrets: [{ id: "s", sealed: SEALED }],
  };

  it("accepts the response the Worker sends", () => {
    expect(isCiResponse(response)).toBe(true);
    expect(isCiResponse({ ...response, secrets: [] })).toBe(true);
  });

  it("rejects a response with missing or mistyped parts", () => {
    expect(isCiResponse({ ...response, generation: "1" })).toBe(false);
    expect(isCiResponse({ ...response, wrappedKey: SEALED })).toBe(false);
    expect(isCiResponse({ ...response, secrets: [{ id: "s" }] })).toBe(false);
    expect(isCiResponse({ ...response, secrets: [null] })).toBe(false);
    expect(isCiResponse(null)).toBe(false);
  });
});

describe("Worker-side guards", () => {
  it("keeps only well-formed JWKs", () => {
    const key = { kid: "k", kty: "RSA", n: "n", e: "AQAB" };
    expect(validJwks([key, { kid: "x" }, null, "k"])).toEqual([key]);
    expect(validJwks({ keys: [key] })).toEqual([]);
  });
});

describe("CLI files", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "7key-guards-"));
    env = { XDG_CONFIG_HOME: home };
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("loads a stored login only when every field has the right type", () => {
    const keyring = fileKeyring(env);
    const login = {
      server: "https://vault.example",
      email: "me@example.com",
      token: "t",
      expiresAt: 2_000_000_000,
      publicKey: "pk",
      privateKey: toBase64(new Uint8Array([1])),
    };
    saveLogin(keyring, login);
    expect(loadLogin(keyring, 1)).toEqual(login);
    keyring.write(Buffer.from(JSON.stringify({ ...login, expiresAt: "never" })).toString("base64"));
    expect(loadLogin(keyring, 1)).toBeNull();
    keyring.write(Buffer.from(JSON.stringify({ ...login, privateKey: 1 })).toString("base64"));
    expect(loadLogin(keyring, 1)).toBeNull();
  });

  it("keeps only the remembered fields that are strings", () => {
    const file = path.join(home, "7key", "config.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ email: "me@example.com", server: 42 }));
    expect(remembered(env)).toEqual({ email: "me@example.com" });
    writeFileSync(file, "[]");
    expect(remembered(env)).toEqual({});
  });

  it("refuses a link file with a missing id", () => {
    const link = {
      server: "https://vault.example",
      org: "Acme",
      project: "api",
      environment: "prod",
      orgId: "o",
      teamId: "t",
      projectId: "p",
      environmentId: "e",
    };
    writeFileSync(path.join(home, ".7key.json"), JSON.stringify(link));
    expect(findLink(home)?.link).toEqual(link);
    writeFileSync(path.join(home, ".7key.json"), JSON.stringify({ ...link, teamId: undefined }));
    expect(() => findLink(home)).toThrow("is not a valid 7key link");
  });
});
