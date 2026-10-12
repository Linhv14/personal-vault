/**
 * Service worker. Its only job is auto-lock.
 *
 * Deliberately thin: MV3 terminates the service worker after roughly 30 seconds
 * idle, so any state held in a variable here disappears without warning. All
 * state lives in `chrome.storage`; this file only cleans up.
 */

import {
  grantsAutofill,
  registerAutofillScript,
  revokesAutofill,
  unregisterAutofillScript,
} from "./lib/autofill-permission.js";
import { isAutofillRequest } from "./lib/autofill-protocol.js";
import { handleAutofill, trustedSender } from "./lib/autofill-service.js";
import { CLIPBOARD_ALARM, clearClipboardNow } from "./lib/clipboard.js";
import { LOCK_ALARM, lock, scheduleLockAlarm } from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(() => void scheduleLockAlarm());

chrome.runtime.onStartup.addListener(() => {
  void lock();
  void scheduleLockAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLIPBOARD_ALARM) {
    void clearClipboardNow().catch((error) => console.warn("Clipboard clear failed:", error));
    return;
  }
  if (alarm.name !== LOCK_ALARM) return;
  void (async () => {
    const { lockAt } = (await chrome.storage.session.get("lockAt")) as { lockAt?: number };
    if (lockAt && Date.now() > lockAt) await lock();
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAutofillRequest(message)) return false;
  const trusted = trustedSender(sender, chrome.runtime.id);
  if (!trusted) {
    sendResponse({ ok: false, error: "untrusted_sender" });
    return false;
  }
  handleAutofill(message, trusted)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

chrome.permissions.onAdded.addListener((permissions) => {
  if (grantsAutofill(permissions)) void registerAutofillScript();
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (revokesAutofill(permissions)) void unregisterAutofillScript();
});
