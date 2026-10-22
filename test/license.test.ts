import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "../src/core/bytes.js";
import { checkLicense, licenseAllows } from "../commercial/core/license.js";
import { LICENSE_PUBLIC_KEY } from "../commercial/core/license-key.js";
import { signLicense, type LicenseTerms } from "../commercial/scripts/issue-license.js";

const LICENSE_TEST_KEY = JSON.parse(
  readFileSync(new URL("./fixtures/license-test-key.json", import.meta.url), "utf8"),
) as { privateKeyPem: string; publicKey: string };

const NOW = 1_800_000_000;
const terms = (overrides: Partial<LicenseTerms> = {}): LicenseTerms => ({
  licensee: "Acme Corp",
  seats: 50,
  expiresAt: NOW + 86_400,
  features: ["sso"],
  ...overrides,
});
const issue = (overrides: Partial<LicenseTerms> = {}) =>
  signLicense(LICENSE_TEST_KEY.privateKeyPem, terms(overrides));
const check = (token: string | undefined, keys = [LICENSE_TEST_KEY.publicKey]) =>
  checkLicense(token, keys, NOW);

describe("licence keys", () => {
  it("accepts a licence signed by a trusted key and reports its terms", async () => {
    const result = await check(issue());
    expect(result).toEqual({ status: "valid", license: terms() });
    expect(licenseAllows(result, "sso")).toBe(true);
    expect(licenseAllows(result, "scim")).toBe(false);
  });

  it("reports an expired licence and does not allow its features", async () => {
    const result = await check(issue({ expiresAt: NOW - 1 }));
    expect(result.status).toBe("expired");
    expect(licenseAllows(result, "sso")).toBe(false);
  });

  it("rejects a licence signed by a key the server does not trust", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const forged = signLicense(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      terms(),
    );
    expect(await check(forged)).toEqual({ status: "invalid" });
    expect(await check(issue(), [LICENSE_PUBLIC_KEY])).toEqual({ status: "invalid" });
  });

  it("rejects a licence whose terms were changed after signing", async () => {
    const [prefix, payload, signature] = issue().split(".");
    const terms = JSON.parse(utf8Decode(fromBase64Url(payload!))) as LicenseTerms;
    const raised = toBase64Url(utf8Encode(JSON.stringify({ ...terms, seats: 5000 })));
    expect(await check(`${prefix}.${raised}.${signature}`)).toEqual({ status: "invalid" });
    const truncated = signature!.slice(0, -4);
    expect(await check(`${prefix}.${payload}.${truncated}`)).toEqual({ status: "invalid" });
  });

  it("treats a missing, malformed or oversized value as no licence", async () => {
    expect(await check(undefined)).toEqual({ status: "missing" });
    expect(await check("  ")).toEqual({ status: "missing" });
    expect(await check("not-a-licence")).toEqual({ status: "invalid" });
    expect(await check(`7key-license-v1.${"A".repeat(5000)}.AAAA`)).toEqual({ status: "invalid" });
    expect(await check(issue({ seats: 0 }))).toEqual({ status: "invalid" });
  });

  it("ships a production public key that is not the test key", () => {
    expect(LICENSE_PUBLIC_KEY).not.toBe(LICENSE_TEST_KEY.publicKey);
    expect(fromBase64Url(LICENSE_PUBLIC_KEY)).toHaveLength(32);
  });
});
