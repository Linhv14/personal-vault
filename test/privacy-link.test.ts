import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { privacyUrl } from "../src/core/privacy-url.js";
import { startWorker } from "./worker-harness.js";

const PRIVACY = "https://example.test/privacy";

const pages: Record<string, string> = {
  "/share.html": readFileSync(new URL("../share/index.html", import.meta.url), "utf8"),
  "/security": readFileSync(new URL("../share/security.html", import.meta.url), "utf8"),
  "/api-docs": readFileSync(new URL("../share/security.html", import.meta.url), "utf8"),
};

const assets = {
  fetch: async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const page = pages[url.pathname];
    return page
      ? new Response(page, { headers: { "Content-Type": "text/html", ETag: '"asset"' } })
      : new Response("Not found", { status: 404 });
  },
};

async function html(vars: Record<string, unknown>, path: string): Promise<string> {
  const worker = await startWorker({ vars: { ASSETS: assets, ...vars } });
  const response = await worker.fetch(path, { headers: { Accept: "text/html" } });
  expect(response.status).toBe(200);
  return response.text();
}

describe("privacy url", () => {
  it("accepts only absolute https addresses", () => {
    expect(privacyUrl(" https://example.test/privacy ")).toBe(PRIVACY);
    for (const value of [undefined, "", "/privacy", "http://example.test", "javascript:x", 1]) {
      expect(privacyUrl(value)).toBeUndefined();
    }
  });
});

describe("PRIVACY_URL", () => {
  it("publishes the address in /api/config only when it is set and valid", async () => {
    const config = async (vars: Record<string, unknown>) =>
      (await (await startWorker({ vars })).fetch("/api/config")).json() as Promise<
        Record<string, unknown>
      >;
    expect(await config({})).not.toHaveProperty("privacyUrl");
    expect(await config({ PRIVACY_URL: "not a url" })).not.toHaveProperty("privacyUrl");
    expect((await config({ PRIVACY_URL: PRIVACY })).privacyUrl).toBe(PRIVACY);
  });

  it.each(["/s/abc", "/security", "/api-docs"])("links it from %s only when set", async (path) => {
    const without = await html({}, path);
    expect(without).not.toContain("privacy-link");
    expect(without).not.toContain("{{privacyUrl}}");
    expect(without).not.toMatch(/href="[^"]*privacy/);

    const invalid = await html({ PRIVACY_URL: "http://example.test/privacy" }, path);
    expect(invalid).not.toMatch(/href="[^"]*privacy/);

    const linked = await html({ PRIVACY_URL: `${PRIVACY}?a="b"` }, path);
    expect(linked).toContain('href="https://example.test/privacy?a=%22b%22"');
    expect(linked).not.toContain("privacy-link");
  });

  it("drops the asset ETag once the page is filled in", async () => {
    const worker = await startWorker({ vars: { ASSETS: assets, PRIVACY_URL: PRIVACY } });
    const response = await worker.fetch("/security", { headers: { Accept: "text/html" } });
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("adds the privacy line to emails only when set", async () => {
    const send = async (vars: Record<string, unknown>) => {
      const worker = await startWorker({ mailer: true, vars });
      await worker.fetch("/api/auth/verify-email", {
        method: "POST",
        json: { email: "new@example.com" },
      });
      await worker.settle();
      return worker.mail[0]!.text;
    };
    expect(await send({})).not.toContain("Privacy policy");
    expect(await send({ PRIVACY_URL: PRIVACY })).toContain(`Privacy policy: ${PRIVACY}`);
  });
});
