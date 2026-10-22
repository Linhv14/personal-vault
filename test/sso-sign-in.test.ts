// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../extension/lib/master-password.js", () => ({
  checkNewMasterPassword: vi.fn(async () => null),
}));

const { SsoSignIn } = await import("../commercial/extension/sso/SsoSignIn.js");
const { challengeOf } = await import("../commercial/extension/sso/api.js");

const API = "https://vault.example";
const RETURN = "https://vault.example/app/";
const KDF = { type: "pbkdf2-sha256", iterations: 600_000, salt: "c2FsdHNhbHRzYWx0c2FsdA==" };
const WRAPPED = { ciphertext: "AAAA", nonce: "BBBBBBBBBBBBBBBB" };

let requests: { path: string; body: Record<string, unknown> }[];
let sessionReply: Record<string, unknown>;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  requests = [];
  sessionReply = {
    status: "signed_in",
    email: "ana@acme.com",
    orgId: "org-1",
    kdf: KDF,
    token: "session-token",
    wrappedVaultKey: WRAPPED,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push({ path, body });
      if (path === "/api/sso/prepare") {
        return reply({
          orgName: "Acme",
          identifier: "acme",
          authorizeUrl: "https://idp.example/authorize?state=s",
        });
      }
      if (path === "/api/sso/session") {
        return reply(sessionReply);
      }
      return reply({ code: "server.not_found" }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function host(finalUrl: string | null = `${RETURN}#sso_grant=grant-1`) {
  return {
    apiUrl: API,
    returnTo: RETURN,
    launch: vi.fn(async () => finalUrl),
    openVault: vi.fn(async () => {}),
  };
}

async function submitLookup(value: string) {
  const input = await screen.findByLabelText("Work email or organization identifier");
  fireEvent.input(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
}

describe("SSO sign-in", () => {
  it("binds the attempt to a client verifier and unlocks with the master password", async () => {
    const fake = host();
    render(h(SsoSignIn, { host: fake, onCancel: () => {} }));
    await submitLookup("ana@acme.com");
    const form = await screen.findByText("Unlock your vault");
    const prepare = requests.find((entry) => entry.path === "/api/sso/prepare")!;
    const session = requests.find((entry) => entry.path === "/api/sso/session")!;
    expect(prepare.body).toMatchObject({ email: "ana@acme.com", returnTo: RETURN });
    expect(session.body.grant).toBe("grant-1");
    expect(prepare.body.clientChallenge).toBe(
      await challengeOf(String(session.body.clientVerifier)),
    );
    expect(fake.launch).toHaveBeenCalledWith(
      "https://idp.example/authorize?state=s",
      session.body.clientVerifier,
    );

    const password = form.closest("form")!.querySelector<HTMLInputElement>("input[name=password]")!;
    fireEvent.input(password, { target: { value: "correct horse" } });
    fireEvent.submit(password.closest("form")!);
    await waitFor(() =>
      expect(fake.openVault).toHaveBeenCalledWith(
        "ana@acme.com",
        "correct horse",
        KDF,
        WRAPPED,
        "session-token",
      ),
    );
  });

  it("sends an identifier rather than an email when there is no @", async () => {
    render(h(SsoSignIn, { host: host(), onCancel: () => {} }));
    await submitLookup("acme");
    await screen.findByText("Unlock your vault");
    expect(requests[0]!.body).toMatchObject({ identifier: "acme" });
    expect(requests[0]!.body.email).toBeUndefined();
  });

  it("shows the reason when the provider sends the browser back with an error", async () => {
    render(
      h(SsoSignIn, {
        host: host(),
        resume: { url: `${RETURN}#sso_error=sso.email_not_allowed`, verifier: "v" },
        onCancel: () => {},
      }),
    );
    expect(
      await screen.findByText(
        "This email is not on a verified domain of the organization and has no pending invitation.",
      ),
    ).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("shows a generic failure for an unknown error code", async () => {
    render(
      h(SsoSignIn, {
        host: host(`${RETURN}#sso_error=<script>`),
        onCancel: () => {},
      }),
    );
    await submitLookup("acme");
    expect(
      await screen.findByText("The identity provider did not confirm the sign-in. Try again."),
    ).toBeTruthy();
  });

  it("refuses an SSO result for another account than the one on this device", async () => {
    render(h(SsoSignIn, { host: host(), expectedEmail: "bob@acme.com", onCancel: () => {} }));
    await submitLookup("acme");
    expect(
      await screen.findByText(
        "Single sign-on returned ana@acme.com, which is not the account on this device.",
      ),
    ).toBeTruthy();
  });

  it("asks a first-time member for a new master password", async () => {
    sessionReply = {
      status: "register",
      email: "new@acme.com",
      orgName: "Acme",
      registrationGrant: "register-grant",
    };
    render(h(SsoSignIn, { host: host(), onCancel: () => {} }));
    await submitLookup("new@acme.com");
    expect(await screen.findByText("Create your master password")).toBeTruthy();
    const form = document.querySelector<HTMLFormElement>("#form-sso-create")!;
    fireEvent.input(form.querySelector("input[name=password]")!, { target: { value: "a" } });
    fireEvent.input(form.querySelector("input[name=confirm]")!, { target: { value: "b" } });
    fireEvent.submit(form);
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
  });

  it("hands the attempt to a tab instead of starting it from the popup", async () => {
    const delegate = vi.fn();
    const fake = host();
    render(h(SsoSignIn, { host: fake, delegate, onCancel: () => {} }));
    await submitLookup("acme");
    expect(delegate).toHaveBeenCalledWith("acme");
    expect(requests).toEqual([]);
    expect(fake.launch).not.toHaveBeenCalled();
  });
});
