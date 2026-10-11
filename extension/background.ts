/**
 * Service worker. Its only job is auto-lock.
 *
 * Deliberately thin: MV3 terminates the service worker after roughly 30 seconds
 * idle, so any state held in a variable here disappears without warning. All
 * state lives in `chrome.storage`; this file only cleans up.
 */

import { LOCK_ALARM, lock, scheduleLockAlarm } from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(() => void scheduleLockAlarm());

chrome.runtime.onStartup.addListener(() => {
  void lock();
  void scheduleLockAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== LOCK_ALARM) return;
  void (async () => {
    const { lockAt } = (await chrome.storage.session.get("lockAt")) as { lockAt?: number };
    if (lockAt && Date.now() > lockAt) await lock();
  })();
});
