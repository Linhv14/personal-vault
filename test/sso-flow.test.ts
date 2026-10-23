import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSsoStart,
  readPending,
  runSsoAttempt,
  type SsoAttempt,
} from "../commercial/extension/sso/flow.js";

const API = "https://vault.example";
const RETURN = "https://ext-id.chromiumapp.org/";
const KDF = { type: "pbkdf2-sha256", iterations: 600_000, salt: "c2FsdHNhbHRzYWx0c2FsdA==" };
const WRAPPED = { ciphertext: "AAAA", nonce: "BBBBBBBBBBBBBBBB" };

let stored: Record<string, unknown>;
let returned: string | undefined;
let sessionBody: Record<string, unknown>;
const openPopup = vi.fn(async () => {});
const launchWebAuthFlow = vi.fn(async () => returned);

const attempt: SsoAttempt = {
  server: API,
  authorizeUrl: "https://idp.example/authorize?state=s",
  verifier: "verifier-1",
  expectedEmail: null,
  locale: "en",
};

beforeEach(() => {
  stored = {};
  returned = `${RETURN}#sso_grant=grant-1`;
  sessionBody = {
    status: "signed_in",
    email: "ana@acme.com",
    orgId: "org-1",
    kdf: KDF,
    token: "session-token",
    wrappedVaultKey: WRAPPED,
  };
  openPopup.mockClear();
  launchWebAuthFlow.mockClear();
  vi.stubGlobal("chrome", {
    identity: { launchWebAuthFlow },
    action: { openPopup },
    storage: {
      session: {
        set: async (items: Record<string, unknown>) => Object.assign(stored, items),
        get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}),
        remove: async (key: string) => void delete stored[key],
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(sessionBody), {
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSO attempt in the service worker", () => {
  it("redeems the grant, keeps the session and opens the popup again", async () => {
    await runSsoAttempt(attempt);
    expect(launchWebAuthFlow).toHaveBeenCalledWith({
      url: attempt.authorizeUrl,
      interactive: true,
    });
    const pending = await readPending();
    expect(pending).toMatchObject({ server: API, session: { email: "ana@acme.com" } });
    expect(openPopup).toHaveBeenCalled();
  });

  it("keeps nothing when the person closes the provider's window", async () => {
    launchWebAuthFlow.mockRejectedValueOnce(new Error("The user did not approve access."));
    await runSsoAttempt(attempt);
    expect(await readPending()).toBeNull();
    expect(openPopup).not.toHaveBeenCalled();
  });

  it("keeps the provider's refusal for the popup to show", async () => {
    returned = `${RETURN}#sso_error=sso.email_not_allowed`;
    await runSsoAttempt(attempt);
    expect(await readPending()).toMatchObject({
      failure: { messageKey: "error.sso.email_not_allowed" },
    });
  });

  it("refuses a session for another account than the locked one", async () => {
    await runSsoAttempt({ ...attempt, expectedEmail: "bo@acme.com" });
    expect(await readPending()).toMatchObject({
      failure: { messageKey: "sso.wrong_account", params: { email: "ana@acme.com" } },
    });
  });

  it("drops a result older than ten minutes", async () => {
    await runSsoAttempt(attempt);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect(await readPending()).toBeNull();
    vi.restoreAllMocks();
  });

  it("only starts on a well formed message", () => {
    expect(isSsoStart({ type: "sso:start", ...attempt })).toBe(true);
    expect(isSsoStart({ type: "sso:start", ...attempt, verifier: 1 })).toBe(false);
    expect(isSsoStart({ type: "autofill:fill" })).toBe(false);
  });
});
