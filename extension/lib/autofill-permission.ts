import { AUTOFILL_ORIGINS, AUTOFILL_SCRIPT_ID } from "./autofill-protocol.js";

export function autofillSupported(): boolean {
  return typeof chrome.scripting?.registerContentScripts === "function";
}

async function isRegistered(): Promise<boolean> {
  if (!autofillSupported()) return false;
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [AUTOFILL_SCRIPT_ID],
  });
  return registered.length > 0;
}

export function grantsAutofill(permissions: chrome.permissions.Permissions): boolean {
  return AUTOFILL_ORIGINS.every((origin) => permissions.origins?.includes(origin));
}

export function revokesAutofill(permissions: chrome.permissions.Permissions): boolean {
  return AUTOFILL_ORIGINS.some((origin) => permissions.origins?.includes(origin));
}

export async function registerAutofillScript(): Promise<void> {
  if (!autofillSupported() || (await isRegistered())) return;
  await chrome.scripting.registerContentScripts([
    {
      id: AUTOFILL_SCRIPT_ID,
      matches: AUTOFILL_ORIGINS,
      js: ["content/content.js"],
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

export async function unregisterAutofillScript(): Promise<void> {
  if (await isRegistered()) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTOFILL_SCRIPT_ID] });
  }
}

export async function isAutofillEnabled(): Promise<boolean> {
  if (!autofillSupported()) return false;
  const [registered, granted] = await Promise.all([
    isRegistered(),
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
