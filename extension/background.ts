/**
 * Service worker: auto-lock, clipboard clearing, and the trusted side of
 * autofill and passkeys.
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
import {
  AUTOFILL_ORIGINS,
  isAutofillRequest,
  type CardFrameCapture,
} from "./lib/autofill-protocol.js";
import { handleAutofill, trustedSender, type TrustedSender } from "./lib/autofill-service.js";
import { isPasskeyRequest } from "./lib/passkey/protocol.js";
import { handlePasskey } from "./lib/passkey/service.js";
import { forgetCardFrames, rememberCardFrame } from "./lib/card-frames.js";
import { forgetFrameCards, rememberFrameCard } from "./lib/form-save.js";
import { CLIPBOARD_ALARM, clearClipboardNow } from "./lib/clipboard.js";
import { resumeUnlock } from "./lib/resume.js";
import { LOCK_ALARM, lock, scheduleLockAlarm } from "./lib/storage.js";
import { warn } from "./lib/log.js";

chrome.runtime.onInstalled.addListener(() => {
  void scheduleLockAlarm();
  void chrome.permissions.contains({ origins: AUTOFILL_ORIGINS }).then((granted) => {
    if (granted) {
      return registerAutofillScript();
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.storage.session.clear().then(() => resumeUnlock());
  void scheduleLockAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLIPBOARD_ALARM) {
    void clearClipboardNow().catch((error) => warn("Clipboard clear failed:", error));
    return;
  }
  if (alarm.name !== LOCK_ALARM) {
    return;
  }
  void (async () => {
    const { lockAt } = await chrome.storage.session.get<{ lockAt?: number }>("lockAt");
    if (lockAt && Date.now() > lockAt) {
      await lock();
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { type?: unknown } | null)?.type === "autofill:card-frame") {
    void rememberCardFrame(sender, chrome.runtime.id);
    return false;
  }
  if ((message as { type?: unknown } | null)?.type === "autofill:card-frame-capture") {
    void rememberFrameCard(sender, chrome.runtime.id, message as CardFrameCapture);
    return false;
  }
  const handle: ((trusted: TrustedSender) => Promise<unknown>) | null = isAutofillRequest(message)
    ? (trusted) => handleAutofill(message, trusted)
    : isPasskeyRequest(message)
      ? (trusted) => handlePasskey(message, trusted)
      : null;
  if (!handle) {
    return false;
  }
  const trusted = trustedSender(sender, chrome.runtime.id);
  if (!trusted) {
    sendResponse({ ok: false, error: "untrusted_sender" });
    return false;
  }
  handle(trusted)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) {
    void forgetCardFrames(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => void forgetCardFrames(tabId));
chrome.tabs.onRemoved.addListener((tabId) => void forgetFrameCards(tabId));

chrome.permissions.onAdded.addListener((permissions) => {
  if (grantsAutofill(permissions)) {
    void registerAutofillScript();
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (revokesAutofill(permissions)) {
    void unregisterAutofillScript();
  }
});
