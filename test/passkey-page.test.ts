// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { PAGE_ABORT, PAGE_REPLY, PAGE_REQUEST } from "../extension/lib/passkey/protocol.js";

const nativeCreate = vi.fn(async () => "native");
const nativeGet = vi.fn(
  (options?: CredentialRequestOptions) =>
    new Promise((resolve, reject) => {
      if (options?.mediation !== "conditional") {
        return resolve("native");
      }
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    }),
);
Object.defineProperty(navigator, "credentials", {
  value: { create: nativeCreate, get: nativeGet },
  configurable: true,
});
class FakePublicKeyCredential {}
vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
vi.stubGlobal("AuthenticatorAssertionResponse", class {});

const requests: unknown[] = [];
const ids: string[] = [];
const aborts: string[] = [];
window.addEventListener("message", (event) => {
  if (event.data?.type === PAGE_REQUEST) {
    requests.push(event.data.request);
    ids.push(event.data.id);
  }
  if (event.data?.type === PAGE_ABORT) {
    aborts.push(event.data.id);
  }
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

await import("../extension/passkey/page.js");

const publicKey = {
  rp: { name: "Example" },
  user: { id: new Uint8Array(4), name: "me", displayName: "Me" },
  challenge: new Uint8Array(16),
  pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
};

describe("passkey page hook", () => {
  it("offers security-key registrations to 7key too, which can still hand them back", async () => {
    void navigator.credentials.create({
      publicKey: {
        ...publicKey,
        authenticatorSelection: { authenticatorAttachment: "cross-platform" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toMatchObject([{ kind: "create" }]);
    requests.length = 0;
  });

  it("offers platform registrations to 7key", async () => {
    void navigator.credentials.create({ publicKey });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toMatchObject([{ kind: "create", options: { userName: "me" } }]);
    expect(nativeCreate).not.toHaveBeenCalled();
  });

  it("tells sites a platform authenticator is available", async () => {
    await expect(
      (
        PublicKeyCredential as unknown as {
          isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
        }
      ).isUserVerifyingPlatformAuthenticatorAvailable(),
    ).resolves.toBe(true);
  });

  it("offers 7key passkeys for a conditional sign-in and cancels the browser's own prompt", async () => {
    requests.length = 0;
    ids.length = 0;
    const pending = navigator.credentials.get({
      mediation: "conditional",
      publicKey: { challenge: new Uint8Array(16), rpId: "example.com" },
    });
    await settle();
    expect(requests).toMatchObject([{ kind: "conditional", options: { rpId: "example.com" } }]);
    const nativeSignal = nativeGet.mock.calls.at(-1)![0]!.signal!;
    expect(nativeSignal.aborted).toBe(false);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: PAGE_REPLY,
          id: ids[0],
          reply: {
            kind: "assertion",
            assertion: {
              credentialId: "AQID",
              clientDataJSON: "AA",
              authenticatorData: "AA",
              signature: "AA",
              userHandle: "AA",
            },
          },
        },
      }),
    );
    const credential = (await pending) as unknown as { id: string };
    expect(credential.id).toBe("AQID");
    expect(nativeSignal.aborted).toBe(true);
  });

  it("stops offering passkeys when the site aborts a conditional sign-in", async () => {
    ids.length = 0;
    aborts.length = 0;
    const controller = new AbortController();
    const pending = navigator.credentials.get({
      mediation: "conditional",
      signal: controller.signal,
      publicKey: { challenge: new Uint8Array(16) },
    });
    await settle();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await settle();
    expect(aborts).toEqual([ids[0]]);
  });
});
