import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryArea } from "../extension/lib/platform.js";

const fetchLogo = vi.fn<(domain: string) => Promise<Blob | "missing" | null>>();
vi.mock("../extension/lib/api.js", () => ({ fetchLogo }));

const session = memoryArea();

async function freshPopup() {
  vi.resetModules();
  const { usePlatform } = await import("../extension/lib/platform.js");
  usePlatform({ local: memoryArea(), session, scheduleLock: async () => {} });
  return import("../extension/ui/logos.js");
}

beforeEach(async () => {
  await session.clear();
  fetchLogo.mockReset();
});

describe("site logo cache", () => {
  it("keeps a logo in session memory, so reopening the popup does not fetch it again", async () => {
    fetchLogo.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    const first = await freshPopup();
    expect(await first.logoFor("facebook.com")).toBe("data:image/png;base64,AQID");
    const reopened = await freshPopup();
    expect(await reopened.logoFor("facebook.com")).toBe("data:image/png;base64,AQID");
    expect(fetchLogo).toHaveBeenCalledTimes(1);
  });

  it("remembers that a site has no logo, but not a failed request", async () => {
    fetchLogo.mockResolvedValueOnce("missing").mockResolvedValueOnce(null);
    const popup = await freshPopup();
    expect(await popup.logoFor("intranet.example")).toBeNull();
    expect(await popup.logoFor("offline.example")).toBeNull();
    const reopened = await freshPopup();
    fetchLogo.mockResolvedValue("missing");
    await reopened.logoFor("intranet.example");
    await reopened.logoFor("offline.example");
    expect(fetchLogo.mock.calls.map(([domain]) => domain)).toEqual([
      "intranet.example",
      "offline.example",
      "offline.example",
    ]);
  });

  it("forgets every logo when the vault locks", async () => {
    fetchLogo.mockResolvedValue(new Blob([new Uint8Array([9])], { type: "image/png" }));
    await (await freshPopup()).logoFor("github.com");
    await session.clear();
    await (await freshPopup()).logoFor("github.com");
    expect(fetchLogo).toHaveBeenCalledTimes(2);
  });
});
