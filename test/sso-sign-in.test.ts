// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../extension/lib/master-password.js", () => ({
  checkNewMasterPassword: vi.fn(async () => null),
}));

const linkApi = vi.hoisted(() => ({
  ssoLinkStatus: vi.fn(),
  startSsoLink: vi.fn(),
  removeSsoLink: vi.fn(),
}));
const launcher = vi.hoisted(() => ({
  returnTo: "https://vault.example/app/",
  launch: vi.fn(),
}));
const reauth = vi.hoisted(() => ({ currentAuthKey: vi.fn() }));

vi.mock("../commercial/extension/sso/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commercial/extension/sso/api.js")>()),
  ...linkApi,
}));
vi.mock("../commercial/extension/sso/hosts.js", () => ({ linkLauncher: () => launcher }));
vi.mock("../extension/lib/reauth.js", () => reauth);
vi.mock("../extension/console/data.js", () => ({
  useConsole: () => ({ detail: { org: { id: "org-1", name: "Acme" } } }),
}));

const { SsoSignIn } = await import("../commercial/extension/sso/SsoSignIn.js");
const { SsoLinkPanel } = await import("../commercial/extension/sso/SsoLinkPanel.js");
const { pkceChallenge } = await import("../src/core/pkce.js");

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
      await pkceChallenge(String(session.body.clientVerifier)),
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
        "This email is not on a verified domain of the organization and is not linked to it. Sign in with your master password, then link single sign-on in the organization's settings.",
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

  it("waits for the service worker when the host hands the provider step over", async () => {
    const fake = host(null);
    render(h(SsoSignIn, { host: fake, onCancel: () => {} }));
    await submitLookup("acme");
    await waitFor(() => expect(fake.launch).toHaveBeenCalled());
    expect(document.querySelector("#sso-waiting")).toBeTruthy();
    expect(requests.map((entry) => entry.path)).toEqual(["/api/sso/prepare"]);
  });

  it("opens on the master password step when the service worker finished the attempt", async () => {
    const fake = host();
    const session = { ...sessionReply, status: "signed_in" } as never;
    render(
      h(SsoSignIn, {
        host: fake,
        resumed: { at: Date.now(), server: API, session },
        onCancel: () => {},
      }),
    );
    expect(await screen.findByText("Unlock your vault")).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("shows the error the service worker kept", async () => {
    render(
      h(SsoSignIn, {
        host: host(),
        resumed: {
          at: Date.now(),
          server: API,
          failure: { messageKey: "error.sso.email_not_allowed", params: {} },
        },
        onCancel: () => {},
      }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.querySelector("#form-sso")).toBeTruthy();
  });
});

const UNLINKED = { available: true, onDomain: false, twoFactor: false, link: null };
const LINKED = { ...UNLINKED, link: { linkedAt: 1_800_000_000 } };

describe("SSO link panel", () => {
  beforeEach(() => {
    linkApi.ssoLinkStatus.mockResolvedValue(UNLINKED);
    linkApi.startSsoLink.mockResolvedValue("https://idp.example/authorize?state=s");
    linkApi.removeSsoLink.mockResolvedValue(UNLINKED);
    launcher.launch.mockResolvedValue("https://vault.example/app/#sso_link=linked");
    reauth.currentAuthKey.mockResolvedValue("auth-key");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function submit(password = "correct horse", code?: string) {
    const input = await screen.findByLabelText("Current master password");
    fireEvent.input(input, { target: { value: password } });
    if (code !== undefined) {
      fireEvent.input(screen.getByLabelText("Enter the code from your authenticator app"), {
        target: { value: code },
      });
    }
    fireEvent.submit(input.closest("form")!);
  }

  it("stays hidden when SSO is off or the address is on a verified domain", async () => {
    linkApi.ssoLinkStatus.mockResolvedValueOnce({ ...UNLINKED, onDomain: true });
    const { container } = render(h(SsoLinkPanel, {}));
    await waitFor(() => expect(linkApi.ssoLinkStatus).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("proves the master password and the 2FA code, then links through the provider", async () => {
    linkApi.ssoLinkStatus.mockResolvedValueOnce({ ...UNLINKED, twoFactor: true });
    linkApi.ssoLinkStatus.mockResolvedValueOnce(LINKED);
    render(h(SsoLinkPanel, {}));
    await submit("correct horse", "123456");
    expect(await screen.findByText(/^Linked on /)).toBeTruthy();
    expect(reauth.currentAuthKey).toHaveBeenCalledWith("correct horse");
    expect(linkApi.startSsoLink).toHaveBeenCalledWith("org-1", {
      currentAuthKey: "auth-key",
      returnTo: launcher.returnTo,
      code: "123456",
    });
    expect(launcher.launch).toHaveBeenCalledWith(
      "https://idp.example/authorize?state=s",
      expect.any(AbortSignal),
    );
  });

  it("stops at a wrong master password", async () => {
    reauth.currentAuthKey.mockResolvedValueOnce(null);
    render(h(SsoLinkPanel, {}));
    await submit("wrong");
    expect(await screen.findByText("That is not the current master password")).toBeTruthy();
    expect(linkApi.startSsoLink).not.toHaveBeenCalled();
  });

  it("explains a refusal from the provider round trip", async () => {
    launcher.launch.mockResolvedValueOnce(
      "https://vault.example/app/#sso_link_error=sso.link_email_mismatch",
    );
    render(h(SsoLinkPanel, {}));
    await submit();
    expect(await screen.findByText(/different email than this account/)).toBeTruthy();
  });

  it("removes the link", async () => {
    linkApi.ssoLinkStatus.mockResolvedValueOnce(LINKED);
    render(h(SsoLinkPanel, {}));
    fireEvent.click(await screen.findByText("Remove link"));
    expect(await screen.findByLabelText("Current master password")).toBeTruthy();
    expect(linkApi.removeSsoLink).toHaveBeenCalledWith("org-1");
  });
});
