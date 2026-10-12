import { AUTOFILL_ORIGINS, AUTOFILL_SCRIPT_ID } from "./autofill-protocol.js";

export async function isAutofillEnabled(): Promise<boolean> {
  const [registered, granted] = await Promise.all([
    chrome.scripting.getRegisteredContentScripts({ ids: [AUTOFILL_SCRIPT_ID] }),
    chrome.permissions.contains({ origins: AUTOFILL_ORIGINS }),
  ]);
  return registered.length > 0 && granted;
}

export async function enableAutofill(): Promise<boolean> {
  if (!(await chrome.permissions.request({ origins: AUTOFILL_ORIGINS }))) return false;
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [AUTOFILL_SCRIPT_ID],
  });
  if (registered.length === 0) {
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
  return true;
}

export async function disableAutofill(): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [AUTOFILL_SCRIPT_ID],
  });
  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTOFILL_SCRIPT_ID] });
  }
  await chrome.permissions.remove({ origins: AUTOFILL_ORIGINS });
}
