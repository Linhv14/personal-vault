/**
 * End-to-end test against a real Worker and a local D1 database.
 *
 * Skipped by default. To run it:
 *   npm run dev                 (in another terminal)
 *   VAULT_E2E=1 npx vitest run test/e2e.test.ts
 *
 * The goal is not endpoint coverage but the system's central invariant: walk a
 * full lifecycle and confirm the server never sees plaintext.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  createAccount,
  deriveAuthKey,
  deriveMasterKey,
  deriveWrappingKey,
  importVaultKey,
  open,
  openJson,
  sealJson,
  unlockVault,
  type AccountCryptoRecord,
} from "../src/core/crypto.js";
import { toBase64 } from "../src/core/bytes.js";
import { createShare, openShare } from "../src/core/share.js";
import { generateTotp } from "../src/core/totp.js";
import { generatePassword } from "../src/core/generator.js";
import { createPasskey, signAssertion } from "../extension/lib/passkey/authenticator.js";
import { expectCodeAsync } from "./helpers.js";

const BASE = process.env.VAULT_E2E_URL ?? "http://127.0.0.1:8787";
const REGISTRATION_TOKEN = process.env.VAULT_REGISTRATION_TOKEN ?? "token-dev-local";
// The server only enforces a 100,000 minimum; keep tests quick.
const ITERATIONS = 100_000;

const email = `e2e-${Date.now()}@example.com`;
const masterPassword = "end to end test master password";

const enabled = process.env.VAULT_E2E === "1";

async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe.skipIf(!enabled)("full lifecycle against Worker + D1", () => {
  let record: AccountCryptoRecord;
  let vaultKey: CryptoKey;
  let token: string;

  beforeAll(async () => {
    const created = await createAccount(email, masterPassword, ITERATIONS);
    record = created.record;
    vaultKey = created.vaultKey;
  });

  it("exports every store and restores a copy byte for byte, only with the migration token", async () => {
    const auth = { Authorization: "Bearer local-migration-token" };
    expect((await fetch(`${BASE}/api/migration/export`)).status).toBe(401);
    const exported = await (await fetch(`${BASE}/api/migration/export`, { headers: auth })).json();
    const [accountId, dump] = Object.entries(exported.users as Record<string, unknown>).find(
      ([, store]) => Object.keys(store as object).length > 0,
    )!;
    const copyId = crypto.randomUUID();
    const restore = (users: Record<string, unknown>) =>
      fetch(`${BASE}/api/migration/import`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ users, orgs: {} }),
      });
    expect((await restore({ [copyId]: dump })).status).toBe(200);
    expect((await restore({ [accountId]: dump })).status).toBe(409);
    expect((await restore({ [copyId]: dump })).status).toBe(409);
  });

  it("marks API responses as uncacheable and not to be sniffed", async () => {
    const response = await fetch(`${BASE}/api/config`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("refuses registration without the token", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("auth.bad_registration_token");
  });

  it("registers with the correct token", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(201);
    expect(result.body.token).toBeTruthy();
    token = result.body.token;
  });

  it("rejects a duplicate email", async () => {
    const result = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email, ...record }),
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("auth.email_taken");
  });

  it("does not reveal which addresses are registered", async () => {
    const known = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const unknown = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email: `missing-${Date.now()}@example.com` }),
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(Object.keys(unknown.body.kdf).sort()).toEqual(Object.keys(known.body.kdf).sort());
    expect(unknown.body.kdf.type).toBe(known.body.kdf.type);
  });

  it("signs in and hands back a vault key only the client can open", async () => {
    const prelogin = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const derived = await unlockVault(email, masterPassword, {
      kdf: prelogin.body.kdf,
      wrappedVaultKey: record.wrappedVaultKey,
    });

    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, authKey: derived.authKey }),
    });
    expect(login.status).toBe(200);

    const reopened = await unlockVault(email, masterPassword, {
      kdf: prelogin.body.kdf,
      wrappedVaultKey: login.body.wrappedVaultKey,
    });
    expect(reopened.vaultKeyRaw).toEqual(derived.vaultKeyRaw);
    token = login.body.token;
  });

  it("rejects the wrong master password", async () => {
    const created = await createAccount(email, "not the password", ITERATIONS);
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, authKey: created.record.authKey }),
    });
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("auth.invalid_credentials");
  });

  it("requires a session to read items", async () => {
    expect((await api("/api/items")).status).toBe(401);
    // A bogus token must be ASCII: HTTP headers are ByteStrings, so accented
    // characters are rejected by fetch before the request is ever sent.
    expect((await api("/api/items", { token: "not-a-real-token" })).status).toBe(401);
  });

  const itemId = crypto.randomUUID();
  const itemPlain = {
    title: "Example Bank",
    url: "https://bank.example.com",
    username: "customer@example.com",
    password: generatePassword({ length: 24 }).value,
    totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1" as const, digits: 6, period: 30 },
  };

  it("stores and syncs an item as ciphertext only", async () => {
    const sealed = await sealJson(vaultKey, itemPlain);

    const put = await api(`/api/items/${itemId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(sealed),
    });
    expect(put.status).toBe(200);

    const list = await api("/api/items?since=0", { token });
    expect(list.status).toBe(200);

    const row = list.body.items.find((i: any) => i.id === itemId);
    expect(row).toBeTruthy();

    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain("Example Bank");
    expect(raw).not.toContain("bank.example.com");
    expect(raw).not.toContain(itemPlain.password);
    expect(raw).not.toContain("JBSWY3DPEHPK3PXP");

    expect(await openJson(vaultKey, { ciphertext: row.ciphertext, nonce: row.nonce })).toEqual(
      itemPlain,
    );
  });

  it("recovers the whole vault on a new machine from email and password alone", async () => {
    // The path that matters after losing a laptop. A fresh client holds nothing:
    // no cached KDF parameters, no wrapped key, and no registration token — that
    // token only ever gates account creation.
    const prelogin = await api("/api/auth/prelogin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    const masterKey = await deriveMasterKey(email, masterPassword, prelogin.body.kdf);
    const authKey = toBase64(await deriveAuthKey(masterKey));

    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, authKey }),
    });
    expect(login.status).toBe(200);

    const freshVaultKey = await importVaultKey(
      await open(await deriveWrappingKey(masterKey), login.body.wrappedVaultKey),
    );

    const list = await api("/api/items?since=0", { token: login.body.token });
    const row = list.body.items.find((i: any) => i.id === itemId);
    expect(await openJson(freshVaultKey, { ciphertext: row.ciphertext, nonce: row.nonce })).toEqual(
      itemPlain,
    );
  });

  it("returns only items changed after the cursor", async () => {
    const list = await api("/api/items?since=0", { token });
    const after = await api(`/api/items?since=${list.body.serverTime}`, { token });
    for (const row of after.body.items) {
      expect(row.updatedAt).toBeGreaterThan(list.body.serverTime);
    }
  });

  it("deletes with a tombstone rather than removing the row", async () => {
    const del = await api(`/api/items/${itemId}`, { method: "DELETE", token });
    expect(del.status).toBe(200);

    const list = await api("/api/items?since=0", { token });
    const row = list.body.items.find((i: any) => i.id === itemId);
    // An offline device needs this marker, or it would resurrect the item.
    expect(row.deletedAt).toBeGreaterThan(0);
    expect(row.ciphertext).toBeNull();
  });

  it("keeps each account's items in its own store", async () => {
    const otherEmail = `other-${Date.now()}@example.com`;
    const other = await createAccount(otherEmail, "another master password", ITERATIONS);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email: otherEmail, ...other.record }),
    });

    const before = await api("/api/items", { token });
    const original = before.body.items.find((item: { id: string }) => item.id === itemId);
    expect(original).toBeTruthy();

    const sealed = await sealJson(other.vaultKey, { title: "attempted overwrite" });
    const put = await api(`/api/items/${itemId}`, {
      method: "PUT",
      token: registered.body.token,
      body: JSON.stringify(sealed),
    });
    expect(put.status).toBe(200);

    const after = await api("/api/items", { token });
    expect(after.body.items.find((item: { id: string }) => item.id === itemId)).toEqual(original);
    const theirs = await api("/api/items", { token: registered.body.token });
    expect(theirs.body.items.map((item: { id: string }) => item.id)).toEqual([itemId]);
    expect(theirs.body.items[0].ciphertext).toBe(sealed.ciphertext);
  });

  describe("batch import", () => {
    async function sealedBatch(count: number) {
      return Promise.all(
        Array.from({ length: count }, async (_, index) => ({
          id: crypto.randomUUID(),
          ...(await sealJson(vaultKey, { title: `imported ${index}` })),
        })),
      );
    }

    it("creates new items in one request and never overwrites existing ones", async () => {
      const batch = await sealedBatch(3);
      const first = await api("/api/items/batch", {
        method: "POST",
        token,
        body: JSON.stringify({ items: batch }),
      });
      expect(first.status).toBe(200);
      expect(first.body.created.sort()).toEqual(batch.map((item) => item.id).sort());

      const again = await api("/api/items/batch", {
        method: "POST",
        token,
        body: JSON.stringify({ items: [{ ...batch[0], ciphertext: batch[1]!.ciphertext }] }),
      });
      expect(again.body.created).toEqual([]);

      const list = await api("/api/items?since=0", { token });
      const stored = list.body.items.find((row: any) => row.id === batch[0]!.id);
      expect(stored.ciphertext).toBe(batch[0]!.ciphertext);
    });

    it("rejects empty, oversized and malformed batches", async () => {
      for (const items of [
        [],
        await sealedBatch(101),
        [{ id: "not-a-uuid", ciphertext: "AA==", nonce: "AA==" }],
      ]) {
        const result = await api("/api/items/batch", {
          method: "POST",
          token,
          body: JSON.stringify({ items }),
        });
        expect(result.status).toBe(400);
      }
    });
  });

  describe("share links", () => {
    it("lets a recipient decrypt and compute the right 2FA code", async () => {
      const { sealed, fragment } = await createShare({
        title: itemPlain.title,
        username: itemPlain.username,
        password: itemPlain.password,
        totp: itemPlain.totp,
      });

      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 3600, maxViews: 2 }),
      });
      expect(created.status).toBe(201);

      // No token here — that is the entire point of the feature.
      const fetched = await api(`/api/shares/${created.body.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.viewsLeft).toBe(1);

      const payload = await openShare(fragment, fetched.body);
      expect(payload.password).toBe(itemPlain.password);

      const at = Date.now();
      expect(await generateTotp(payload.totp!, at)).toBe(await generateTotp(itemPlain.totp, at));
    });

    it("kills the link once views run out", async () => {
      const { sealed, fragment } = await createShare({ password: "single use" });
      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });

      const first = await api(`/api/shares/${created.body.id}`);
      expect(first.status).toBe(200);
      expect((await openShare(fragment, first.body)).password).toBe("single use");

      const second = await api(`/api/shares/${created.body.id}`);
      expect(second.status).toBe(404);
      expect(second.body.code).toBe("shares.gone");
    });

    it("keeps a link without a view limit open until it expires", async () => {
      const { sealed } = await createShare({ password: "many views" });
      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: null }),
      });
      expect(created.status).toBe(201);
      expect(created.body.maxViews).toBeNull();

      for (let view = 0; view < 3; view++) {
        const fetched = await api(`/api/shares/${created.body.id}`);
        expect(fetched.status).toBe(200);
        expect(fetched.body.viewsLeft).toBeNull();
      }

      const status = await api("/api/shares/status", {
        method: "POST",
        token,
        body: JSON.stringify({
          shares: [{ id: created.body.id, revokeToken: created.body.revokeToken }],
        }),
      });
      expect(status.body.shares[0]).toMatchObject({ active: true, viewsLeft: null });
    });

    it("requires a session to create a link but not to read one", async () => {
      const { sealed } = await createShare({ password: "x" });
      const result = await api("/api/shares", {
        method: "POST",
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });
      expect(result.status).toBe(401);
    });

    it("rejects out-of-range ttl and view limits", async () => {
      const { sealed } = await createShare({ password: "x" });
      for (const body of [
        { ...sealed, ttlSeconds: 10, maxViews: 1 },
        { ...sealed, ttlSeconds: 999_999_999, maxViews: 1 },
        { ...sealed, ttlSeconds: 600, maxViews: 0 },
        { ...sealed, ttlSeconds: 600, maxViews: 1000 },
        { ...sealed, ttlSeconds: 600 },
      ]) {
        const result = await api("/api/shares", {
          method: "POST",
          token,
          body: JSON.stringify(body),
        });
        expect(result.status).toBe(400);
      }
    });

    it("keeps a passphrase-protected payload useless without the passphrase", async () => {
      const { sealed, fragment } = await createShare({ password: "two factors" }, "coffee");
      const created = await api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 1 }),
      });

      const fetched = await api(`/api/shares/${created.body.id}`);
      await expectCodeAsync(openShare(fragment, fetched.body, "tea"), "share.wrong_passphrase");
      // Same ciphertext, right passphrase — and no extra view is consumed.
      expect((await openShare(fragment, fetched.body, "coffee")).password).toBe("two factors");
    });
  });

  it("refuses a password change from a session without the current auth key", async () => {
    const forged = await createAccount(email, "attacker chosen password", ITERATIONS);
    const withoutProof = await api("/api/auth/change-password", {
      method: "POST",
      token,
      body: JSON.stringify(forged.record),
    });
    expect(withoutProof.status).toBe(400);

    const wrongProof = await api("/api/auth/change-password", {
      method: "POST",
      token,
      body: JSON.stringify({ currentAuthKey: forged.record.authKey, ...forged.record }),
    });
    expect(wrongProof.status).toBe(403);
    expect(wrongProof.body.code).toBe("auth.invalid_credentials");

    const unlocked = await unlockVault(email, masterPassword, {
      kdf: (await api("/api/auth/prelogin", { method: "POST", body: JSON.stringify({ email }) }))
        .body.kdf,
      wrappedVaultKey: record.wrappedVaultKey,
    });
    expect(unlocked.authKey).toBe(record.authKey);
  });

  describe("share controls", () => {
    async function createLink(extra: Record<string, unknown> = {}) {
      const { sealed } = await createShare({ password: "controlled" });
      return api("/api/shares", {
        method: "POST",
        token,
        body: JSON.stringify({ ...sealed, ttlSeconds: 600, maxViews: 5, ...extra }),
      });
    }

    it("revokes a link only with its revoke token", async () => {
      const created = await createLink();
      expect(created.status).toBe(201);
      const { id, revokeToken } = created.body;

      const before = await api("/api/shares/status", {
        method: "POST",
        token,
        body: JSON.stringify({ shares: [{ id, revokeToken }] }),
      });
      expect(before.body.shares[0]).toMatchObject({ id, active: true, viewsLeft: 5 });

      const wrong = await api(`/api/shares/${id}`, {
        method: "DELETE",
        token,
        headers: { "X-Revoke-Token": "not-the-token" },
      });
      expect(wrong.status).toBe(404);

      const revoked = await api(`/api/shares/${id}`, {
        method: "DELETE",
        token,
        headers: { "X-Revoke-Token": revokeToken },
      });
      expect(revoked.status).toBe(200);
      expect((await api(`/api/shares/${id}`)).status).toBe(404);

      const after = await api("/api/shares/status", {
        method: "POST",
        token,
        body: JSON.stringify({ shares: [{ id, revokeToken }] }),
      });
      expect(after.body.shares[0]).toEqual({ id, active: false });
    });

    it("accepts up to 30 days and refuses longer", async () => {
      expect((await createLink({ ttlSeconds: 30 * 86_400 })).status).toBe(201);
      expect((await createLink({ ttlSeconds: 31 * 86_400 })).status).toBe(400);
    });

    it("refuses to restrict a link to addresses when the server cannot send email", async () => {
      const config = await api("/api/config");
      const result = await createLink({ recipients: ["friend@example.com"] });
      if (config.body.emailVerification) {
        expect(result.status).toBe(201);
      } else {
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("shares.email_unavailable");
      }
    });
  });

  it("invalidates the token on logout", async () => {
    expect((await api("/api/auth/logout", { method: "POST", token })).status).toBe(200);
    expect((await api("/api/items", { token })).status).toBe(401);
  });

  it("reports the registration mode so the extension can hide the token field", async () => {
    const result = await api("/api/config");
    expect(result.status).toBe(200);
    expect(["open", "token"]).toContain(result.body.registration);
  });

  it("deletes an account and its items only with the current auth key", async () => {
    const doomedEmail = `doomed-${Date.now()}@example.com`;
    const doomed = await createAccount(doomedEmail, "a password to delete", ITERATIONS);
    const registered = await api("/api/auth/register", {
      method: "POST",
      headers: { "x-registration-token": REGISTRATION_TOKEN },
      body: JSON.stringify({ email: doomedEmail, ...doomed.record }),
    });
    const doomedToken = registered.body.token;
    await api(`/api/items/${crypto.randomUUID()}`, {
      method: "PUT",
      token: doomedToken,
      body: JSON.stringify(await sealJson(doomed.vaultKey, { title: "gone soon" })),
    });

    const wrongKey = await api("/api/auth/delete-account", {
      method: "POST",
      token: doomedToken,
      body: JSON.stringify({ currentAuthKey: record.authKey }),
    });
    expect(wrongKey.status).toBe(403);

    const deleted = await api("/api/auth/delete-account", {
      method: "POST",
      token: doomedToken,
      body: JSON.stringify({ currentAuthKey: doomed.record.authKey }),
    });
    expect(deleted.status).toBe(200);

    expect((await api("/api/items", { token: doomedToken })).status).toBe(401);
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: doomedEmail, authKey: doomed.record.authKey }),
    });
    expect(login.status).toBe(401);
  });

  it("exposes server time for clock-drift detection", async () => {
    const result = await api("/api/time");
    expect(result.status).toBe(200);
    expect(Math.abs(result.body.serverTime - Math.floor(Date.now() / 1000))).toBeLessThan(60);
  });

  describe("PIN and biometric unlock", () => {
    const verifier = (byte: number) => toBase64(new Uint8Array(32).fill(byte));
    let token: string;

    beforeAll(async () => {
      const pinEmail = `pin-${Date.now()}@example.com`;
      const created = await createAccount(pinEmail, "a password for the pin tests", ITERATIONS);
      const registered = await api("/api/auth/register", {
        method: "POST",
        headers: { "x-registration-token": REGISTRATION_TOKEN },
        body: JSON.stringify({ email: pinEmail, ...created.record }),
      });
      token = registered.body.token;
    });

    it("hands the PIN key back only for the right verifier and counts wrong tries", async () => {
      const set = await api("/api/auth/pin", {
        method: "PUT",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect(set.status).toBe(200);
      const { pinKey } = set.body;

      const wrong = await api("/api/auth/pin/unlock", {
        method: "POST",
        token,
        body: JSON.stringify({ verifier: verifier(2) }),
      });
      expect(wrong.status).toBe(403);
      expect(wrong.body).toMatchObject({ code: "auth.pin_wrong", params: { count: 4 } });

      const right = await api("/api/auth/pin/unlock", {
        method: "POST",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect(right.status).toBe(200);
      expect(right.body.pinKey).toBe(pinKey);

      const again = await api("/api/auth/pin/unlock", {
        method: "POST",
        token,
        body: JSON.stringify({ verifier: verifier(2) }),
      });
      expect(again.body.params.count).toBe(4);
    });

    it("wipes the PIN after five wrong tries, even with the right one afterwards", async () => {
      await api("/api/auth/pin", {
        method: "PUT",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await api("/api/auth/pin/unlock", {
          method: "POST",
          token,
          body: JSON.stringify({ verifier: verifier(9) }),
        });
        statuses.push(result.status);
      }
      expect(statuses).toEqual([403, 403, 403, 403, 410]);
      const right = await api("/api/auth/pin/unlock", {
        method: "POST",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect(right.status).toBe(410);
      expect(right.body.code).toBe("auth.pin_off");
    });

    it("needs a live session and a well-formed verifier", async () => {
      const anonymous = await api("/api/auth/pin/unlock", {
        method: "POST",
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect(anonymous.status).toBe(401);
      const malformed = await api("/api/auth/pin", {
        method: "PUT",
        token,
        body: JSON.stringify({ verifier: "short" }),
      });
      expect(malformed.status).toBe(400);
    });

    it("turns off on request", async () => {
      await api("/api/auth/pin", {
        method: "PUT",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect((await api("/api/auth/pin", { method: "DELETE", token })).status).toBe(200);
      const result = await api("/api/auth/pin/unlock", {
        method: "POST",
        token,
        body: JSON.stringify({ verifier: verifier(1) }),
      });
      expect(result.status).toBe(410);
    });

    it("releases the biometric key for a fresh signature from the registered authenticator only", async () => {
      const rpId = "eepgmbamigmadeddhcoldncaolikeagm";
      const origin = `chrome-extension://${rpId}`;
      const { registration, passkey } = await createPasskey({
        rpId,
        origin,
        challenge: "AA",
        userHandle: "dXNlcg",
        userName: "me",
      });
      const set = await api("/api/auth/biometric", {
        method: "PUT",
        token,
        body: JSON.stringify({
          credentialId: registration.credentialId,
          publicKey: registration.publicKey,
          algorithm: registration.publicKeyAlgorithm,
          rpId,
          origin,
        }),
      });
      expect(set.status).toBe(200);

      const issued = await api("/api/auth/biometric/challenge", { method: "POST", token });
      expect(issued.body.credentialId).toBe(registration.credentialId);
      const assertion = await signAssertion(passkey, { origin, challenge: issued.body.challenge });
      const unlocked = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(assertion),
      });
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.bioKey).toBe(set.body.bioKey);

      const replay = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(assertion),
      });
      expect(replay.status).toBe(403);

      const next = await api("/api/auth/biometric/challenge", { method: "POST", token });
      const stranger = await createPasskey({
        rpId,
        origin,
        challenge: "AA",
        userHandle: "dXNlcg",
        userName: "x",
      });
      const forged = await signAssertion(
        { ...stranger.passkey, credentialId: registration.credentialId },
        { origin, challenge: next.body.challenge },
      );
      const refused = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(forged),
      });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("auth.biometric_failed");
    });

    it("accepts a signature over any recent challenge once", async () => {
      const rpId = "eepgmbamigmadeddhcoldncaolikeagm";
      const origin = `chrome-extension://${rpId}`;
      const { registration, passkey } = await createPasskey({
        rpId,
        origin,
        challenge: "AA",
        userHandle: "dXNlcg",
        userName: "me",
      });
      const set = await api("/api/auth/biometric", {
        method: "PUT",
        token,
        body: JSON.stringify({
          credentialId: registration.credentialId,
          publicKey: registration.publicKey,
          algorithm: registration.publicKeyAlgorithm,
          rpId,
          origin,
        }),
      });
      const first = await api("/api/auth/biometric/challenge", { method: "POST", token });
      const second = await api("/api/auth/biometric/challenge", { method: "POST", token });
      expect(first.body.challenge).not.toBe(second.body.challenge);

      const signed = await signAssertion(passkey, { origin, challenge: first.body.challenge });
      const unlocked = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(signed),
      });
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.bioKey).toBe(set.body.bioKey);
      const replay = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(signed),
      });
      expect(replay.status).toBe(403);

      const later = await signAssertion(passkey, { origin, challenge: second.body.challenge });
      const alsoUnlocked = await api("/api/auth/biometric/unlock", {
        method: "POST",
        token,
        body: JSON.stringify(later),
      });
      expect(alsoUnlocked.status).toBe(200);
    });

    it("only registers an extension origin with its own RP ID", async () => {
      const result = await api("/api/auth/biometric", {
        method: "PUT",
        token,
        body: JSON.stringify({
          credentialId: "AQID",
          publicKey: "AQID",
          algorithm: -7,
          rpId: "evil.example",
          origin: "https://evil.example",
        }),
      });
      expect(result.status).toBe(400);
      expect((await api("/api/auth/biometric", { method: "DELETE", token })).status).toBe(200);
      const off = await api("/api/auth/biometric/challenge", { method: "POST", token });
      expect(off.status).toBe(410);
    });

    it("writes a conditional update only over the version it was read from", async () => {
      const id = crypto.randomUUID();
      const sealed = {
        ciphertext: toBase64(new Uint8Array(40).fill(1)),
        nonce: toBase64(new Uint8Array(12)),
      };
      const created = await api(`/api/items/${id}`, {
        method: "PUT",
        token,
        body: JSON.stringify(sealed),
      });
      const stale = await api(`/api/items/${id}?ifUpdatedAt=${created.body.updatedAt - 1}`, {
        method: "PUT",
        token,
        body: JSON.stringify(sealed),
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("items.conflict");
      const fresh = await api(`/api/items/${id}?ifUpdatedAt=${created.body.updatedAt}`, {
        method: "PUT",
        token,
        body: JSON.stringify(sealed),
      });
      expect(fresh.status).toBe(200);
      await api(`/api/items/${id}`, { method: "DELETE", token });
      const revived = await api(`/api/items/${id}?ifUpdatedAt=${fresh.body.updatedAt}`, {
        method: "PUT",
        token,
        body: JSON.stringify(sealed),
      });
      expect(revived.status).toBe(409);
    });

    it("stores one account key pair and never replaces it", async () => {
      const { createIdentity } = await import("../src/core/identity.js");
      const empty = await api("/api/account/identity", { token });
      expect(empty.body).toEqual({ identity: null });
      const first = await createIdentity();
      const wrappedPrivateKey = {
        ciphertext: toBase64(new Uint8Array(150)),
        nonce: toBase64(new Uint8Array(12)),
      };
      const stored = await api("/api/account/identity", {
        method: "PUT",
        token,
        body: JSON.stringify({ publicKey: first.publicKey, wrappedPrivateKey }),
      });
      expect(stored.status).toBe(200);
      const replaced = await api("/api/account/identity", {
        method: "PUT",
        token,
        body: JSON.stringify({ publicKey: (await createIdentity()).publicKey, wrappedPrivateKey }),
      });
      expect(replaced.status).toBe(409);
      const read = await api("/api/account/identity", { token });
      expect(read.body.identity).toEqual({ publicKey: first.publicKey, wrappedPrivateKey });
      expect((await api("/api/account/identity")).status).toBe(401);
    });
  });
});
