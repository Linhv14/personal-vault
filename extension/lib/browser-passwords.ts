export type BrowserPasswordsState = "ours" | "browser" | "other_extension" | "managed";

const PERMISSION = { permissions: ["privacy"] };

type Setting = chrome.types.ChromeSetting;
type Details = chrome.types.ChromeSettingGetResultDetails;

function setting(): Setting | null {
  return chrome.privacy?.services?.passwordSavingEnabled ?? null;
}

const read = (current: Setting) =>
  new Promise<Details>((resolve) => current.get({}, (details) => resolve(details)));
const write = (current: Setting, value: boolean) =>
  new Promise<void>((resolve) => current.set({ value }, () => resolve()));
const reset = (current: Setting) =>
  new Promise<void>((resolve) => current.clear({}, () => resolve()));

export function browserPasswordsSupported(): boolean {
  return typeof chrome.permissions?.request === "function";
}

export async function browserPasswordsState(): Promise<BrowserPasswordsState> {
  if (!(await chrome.permissions.contains(PERMISSION))) return "browser";
  const current = setting();
  if (!current) return "browser";
  const { value, levelOfControl } = await read(current);
  if (levelOfControl === "not_controllable") return "managed";
  if (levelOfControl === "controlled_by_other_extensions") return "other_extension";
  return levelOfControl === "controlled_by_this_extension" && value === false ? "ours" : "browser";
}

export async function takeOverBrowserPasswords(): Promise<BrowserPasswordsState> {
  const held = await chrome.permissions.contains(PERMISSION);
  if (!held && !(await chrome.permissions.request(PERMISSION))) return "browser";
  const current = setting();
  if (!current) return "browser";
  const { levelOfControl } = await read(current);
  if (levelOfControl === "not_controllable") return "managed";
  if (levelOfControl === "controlled_by_other_extensions") return "other_extension";
  await write(current, false);
  return browserPasswordsState();
}

export async function giveBackBrowserPasswords(): Promise<void> {
  const current = setting();
  if (current) await reset(current);
  await chrome.permissions.remove(PERMISSION);
}

export type BrowserName = "chrome" | "edge" | "brave" | "opera" | "vivaldi" | "firefox" | "other";

const SETTINGS_PAGES: Record<BrowserName, string | null> = {
  chrome: "chrome://password-manager/settings",
  edge: "edge://settings/passwords",
  brave: "brave://password-manager/settings",
  opera: "opera://settings/passwords",
  vivaldi: "vivaldi://settings/privacy",
  firefox: "about:preferences#privacy",
  other: null,
};

interface Environment {
  userAgent: string;
  brands: string[];
  brave: boolean;
}

function environment(): Environment {
  const data = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
  return {
    userAgent: navigator.userAgent,
    brands: (data?.brands ?? []).map(({ brand }) => brand),
    brave: "brave" in navigator,
  };
}

export function detectBrowser(env: Environment = environment()): BrowserName {
  if (env.brave) return "brave";
  if (env.brands.includes("Microsoft Edge") || /\bEdg\//.test(env.userAgent)) return "edge";
  if (env.brands.includes("Opera") || /\bOPR\//.test(env.userAgent)) return "opera";
  if (/\bVivaldi\//.test(env.userAgent)) return "vivaldi";
  if (/\bFirefox\//.test(env.userAgent)) return "firefox";
  if (env.brands.includes("Google Chrome") || /\bChrome\//.test(env.userAgent)) return "chrome";
  return "other";
}

export function passwordSettingsPage(browser: BrowserName = detectBrowser()): string | null {
  return SETTINGS_PAGES[browser];
}

export async function openPasswordSettings(): Promise<boolean> {
  const url = passwordSettingsPage();
  if (!url) return false;
  try {
    await chrome.tabs.create({ url });
    return true;
  } catch {
    return false;
  }
}
