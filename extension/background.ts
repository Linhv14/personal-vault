/**
 * Service worker của extension. Nhiệm vụ duy nhất: auto-lock.
 *
 * Cố tình giữ nó mỏng. Service worker của MV3 bị browser kill sau khoảng 30 giây
 * không hoạt động, nên mọi trạng thái đặt trong biến ở đây đều biến mất không báo
 * trước. Toàn bộ trạng thái nằm trong `chrome.storage`; file này chỉ dọn dẹp.
 */

import { LOCK_ALARM, lock, scheduleLockAlarm } from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(() => void scheduleLockAlarm());
chrome.runtime.onStartup.addListener(() => {
  // `storage.session` đã tự rỗng sau khi đóng browser, nhưng gọi lock() cho chắc
  // và để alarm được dựng lại.
  void lock();
  void scheduleLockAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== LOCK_ALARM) return;
  void (async () => {
    const { lockAt } = (await chrome.storage.session.get("lockAt")) as { lockAt?: number };
    if (lockAt && Date.now() > lockAt) {
      await lock();
    }
  })();
});
