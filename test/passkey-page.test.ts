// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { PAGE_REQUEST } from "../extension/lib/passkey/protocol.js";

const nativeCreate = vi.fn(async () => "native");
const nativeGet = vi.fn(async () => "native");
Object.defineProperty(navigator, "credentials", {
  value: { create: nativeCreate, get: nativeGet },
  configurable: true,
});
class FakePublicKeyCredential {}
vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);

const requests: unknown[] = [];
window.addEventListener("message", (event) => {
  if (event.data?.type === PAGE_REQUEST) requests.push(event.data.request);
});

await import("../extension/passkey/page.js");

const publicKey = {
  rp: { name: "Example" },
  user: { id: new Uint8Array(4), name: "me", displayName: "Me" },
  challenge: new Uint8Array(16),
  pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
};

describe("passkey page hook", () => {
  it("leaves security-key registrations to the browser", async () => {
    await expect(
      navigator.credentials.create({
        publicKey: {
          ...publicKey,
          authenticatorSelection: { authenticatorAttachment: "cross-platform" },
        },
      }),
    ).resolves.toBe("native");
    expect(requests).toHaveLength(0);
  });

  it("offers platform registrations to 1PW", async () => {
    void navigator.credentials.create({ publicKey });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toMatchObject([{ kind: "create", options: { userName: "me" } }]);
    expect(nativeCreate).toHaveBeenCalledTimes(1);
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
});
