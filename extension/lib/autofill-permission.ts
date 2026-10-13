import {
  AUTOFILL_ORIGINS,
  AUTOFILL_SCRIPT_ID,
  PASSKEY_BRIDGE_SCRIPT_ID,
  PASSKEY_PAGE_SCRIPT_ID,
} from "./autofill-protocol.js";

const SCRIPTS: chrome.scripting.RegisteredContentScript[] = [
  {
    id: AUTOFILL_SCRIPT_ID,
    matches: AUTOFILL_ORIGINS,
    js: ["content/content.js"],
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true,
  },
  {
    id: PASSKEY_PAGE_SCRIPT_ID,
    matches: AUTOFILL_ORIGINS,
    js: ["passkey/page.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: false,
    persistAcrossSessions: true,
  },
  {
    id: PASSKEY_BRIDGE_SCRIPT_ID,
    matches: AUTOFILL_ORIGINS,
    js: ["passkey/bridge.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true,
  },
];

export function autofillSupported(): boolean {
  return typeof chrome.scripting?.registerContentScripts === "function";
}

async function registeredIds(): Promise<Set<string>> {
  if (!autofillSupported()) return new Set();
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: SCRIPTS.map(({ id }) => id),
  });
  return new Set(registered.map(({ id }) => id));
}

export function grantsAutofill(permissions: chrome.permissions.Permissions): boolean {
  return AUTOFILL_ORIGINS.every((origin) => permissions.origins?.includes(origin));
}

export function revokesAutofill(permissions: chrome.permissions.Permissions): boolean {
  return AUTOFILL_ORIGINS.some((origin) => permissions.origins?.includes(origin));
}

export async function registerAutofillScript(): Promise<void> {
  if (!autofillSupported()) return;
  const present = await registeredIds();
  const missing = SCRIPTS.filter(({ id }) => !present.has(id));
  if (missing.length > 0) await chrome.scripting.registerContentScripts(missing);
}

export async function unregisterAutofillScript(): Promise<void> {
  const present = [...(await registeredIds())];
  if (present.length > 0) await chrome.scripting.unregisterContentScripts({ ids: present });
}

export async function isAutofillEnabled(): Promise<boolean> {
  if (!autofillSupported()) return false;
  const [registered, granted] = await Promise.all([
    registeredIds().then((ids) => ids.has(AUTOFILL_SCRIPT_ID)),
    chrome.permissions.contains({ origins: AUTOFILL_ORIGINS }),
  ]);
  return registered && granted;
}

export async function enableAutofill(): Promise<boolean> {
  if (!autofillSupported()) return false;
  const granted = await chrome.permissions.request({ origins: AUTOFILL_ORIGINS });
  if (granted) await registerAutofillScript();
  return granted;
}

export async function disableAutofill(): Promise<void> {
  await unregisterAutofillScript();
  await chrome.permissions.remove({ origins: AUTOFILL_ORIGINS });
}
