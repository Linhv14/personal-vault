import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailer } from "../src/worker/mailer.js";

const message = { to: "user@example.com", subject: "Code", text: "123456", html: "<p>123456</p>" };

afterEach(() => vi.unstubAllGlobals());

describe("createMailer", () => {
  it("is disabled without a sender address or a transport", () => {
    expect(createMailer({})).toBeNull();
    expect(createMailer({ RESEND_API_KEY: "key" })).toBeNull();
    expect(createMailer({ EMAIL_FROM: "no-reply@1pw.online" })).toBeNull();
  });

  it("sends through Resend with the API key and a named sender", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createMailer({ EMAIL_FROM: "no-reply@1pw.online", RESEND_API_KEY: "re_test" })!.send(
      message,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Personal Vault <no-reply@1pw.online>",
      to: ["user@example.com"],
      subject: "Code",
      text: "123456",
      html: "<p>123456</p>",
    });
  });

  it("surfaces a rejected Resend request instead of reporting success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("domain not verified", { status: 403 })),
    );
    const mailer = createMailer({ EMAIL_FROM: "no-reply@1pw.online", RESEND_API_KEY: "re_test" })!;
    await expect(mailer.send(message)).rejects.toThrow(/403.*domain not verified/);
  });

  it("prefers Resend when both transports are configured", async () => {
    const binding = { send: vi.fn(async () => ({})) };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    await createMailer({ EMAIL_FROM: "a@b.co", RESEND_API_KEY: "k", EMAIL: binding })!.send(
      message,
    );
    expect(binding.send).not.toHaveBeenCalled();
  });

  it("uses the Cloudflare binding when it is the only transport", async () => {
    const binding = { send: vi.fn(async () => ({})) };
    await createMailer({ EMAIL_FROM: "no-reply@1pw.online", EMAIL: binding })!.send(message);
    expect(binding.send).toHaveBeenCalledWith({
      ...message,
      from: { email: "no-reply@1pw.online", name: "Personal Vault" },
    });
  });
});
