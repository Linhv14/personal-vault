import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserPasswordsState,
  detectBrowser,
  giveBackBrowserPasswords,
  passwordSettingsPage,
  takeOverBrowserPasswords,
} from "../extension/lib/browser-passwords.js";

type Level =
  | "not_controllable"
  | "controlled_by_other_extensions"
  | "controllable_by_this_extension"
  | "controlled_by_this_extension";

const browser = { value: true, level: "controllable_by_this_extension" as Level };
let granted = false;
let grant = true;

beforeEach(() => {
  Object.assign(browser, { value: true, level: "controllable_by_this_extension" });
  granted = false;
  grant = true;
  vi.stubGlobal("chrome", {
    permissions: {
      contains: async () => granted,
      request: async () => (granted = grant),
      remove: async () => !(granted = false),
    },
    privacy: {
      services: {
        passwordSavingEnabled: {
          get: (_: unknown, done: (details: { value: boolean; levelOfControl: Level }) => void) =>
            done({ value: browser.value, levelOfControl: browser.level }),
          set: ({ value }: { value: boolean }, done: () => void) => {
            Object.assign(browser, { value, level: "controlled_by_this_extension" });
            done();
          },
          clear: (_: unknown, done: () => void) => {
            Object.assign(browser, { value: true, level: "controllable_by_this_extension" });
            done();
          },
        },
      },
    },
  });
});

describe("taking over the browser's password manager", () => {
  it("turns the browser's saving off after asking for the permission, and gives it back", async () => {
    expect(await browserPasswordsState()).toBe("browser");
    expect(await takeOverBrowserPasswords()).toBe("ours");
    expect(browser.value).toBe(false);
    await giveBackBrowserPasswords();
    expect(browser.value).toBe(true);
    expect(granted).toBe(false);
    expect(await browserPasswordsState()).toBe("browser");
  });

  it("changes nothing when the permission is refused", async () => {
    grant = false;
    expect(await takeOverBrowserPasswords()).toBe("browser");
    expect(browser.value).toBe(true);
  });

  it("reports a policy or another extension instead of fighting it", async () => {
    browser.level = "not_controllable";
    expect(await takeOverBrowserPasswords()).toBe("managed");
    browser.level = "controlled_by_other_extensions";
    expect(await takeOverBrowserPasswords()).toBe("other_extension");
    expect(browser.value).toBe(true);
  });
});

describe("browsers", () => {
  const chromeUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  it("recognises Chromium browsers and Firefox and knows their password settings", () => {
    const env = (extra: Partial<{ userAgent: string; brands: string[]; brave: boolean }>) => ({
      userAgent: chromeUa,
      brands: ["Chromium", "Google Chrome"],
      brave: false,
      ...extra,
    });
    expect(detectBrowser(env({}))).toBe("chrome");
    expect(detectBrowser(env({ brave: true, brands: ["Brave"] }))).toBe("brave");
    expect(
      detectBrowser(env({ brands: ["Microsoft Edge"], userAgent: `${chromeUa} Edg/142.0` })),
    ).toBe("edge");
    expect(detectBrowser(env({ brands: ["Opera"], userAgent: `${chromeUa} OPR/120.0` }))).toBe(
      "opera",
    );
    expect(detectBrowser(env({ brands: [], userAgent: `${chromeUa} Vivaldi/7.5` }))).toBe(
      "vivaldi",
    );
    expect(
      detectBrowser(
        env({ brands: [], userAgent: "Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/140.0" }),
      ),
    ).toBe("firefox");
    expect(passwordSettingsPage("edge")).toBe("edge://settings/passwords");
    expect(passwordSettingsPage("brave")).toBe("brave://password-manager/settings");
    expect(passwordSettingsPage("other")).toBeNull();
  });
});
