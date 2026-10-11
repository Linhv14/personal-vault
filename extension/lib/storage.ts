/**
 * Hai vùng lưu trữ, và ranh giới giữa chúng là quyết định bảo mật quan trọng
 * nhất của extension:
 *
 * - `chrome.storage.local` nằm TRÊN ĐĨA, dạng rõ. Chỉ chứa ciphertext và cấu
 *   hình. Không bao giờ chứa khoá hay plaintext.
 * - `chrome.storage.session` nằm TRONG BỘ NHỚ, tự xoá khi đóng browser. Chứa
 *   vault key và session token.
 *
 * Nhầm hai vùng này là lỗi làm sụp toàn bộ mô hình bảo mật mà không có dấu hiệu
 * nào nhìn thấy được: app vẫn chạy đúng, chỉ là khoá của bạn đã nằm trên đĩa.
 */

import type { KdfParams, SealedData } from "../../src/core/crypto.js";

/** Bản ghi item như server lưu — luôn là ciphertext. */
export interface CachedItem {
  id: string;
  ciphertext: string | null;
  nonce: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LocalState {
  apiUrl?: string;
  email?: string;
  kdf?: KdfParams;
  /** Cache để unlock được khi không có mạng. */
  wrappedVaultKey?: SealedData;
  items?: CachedItem[];
  lastSync?: number;
  autoLockMinutes?: number;
  /** Lệch đồng hồ máy so với server, tính bằng giây. */
  clockSkew?: number;
}

interface SessionState {
  vaultKeyRaw?: string; // base64
  token?: string;
  lockAt?: number; // epoch ms
}

export const DEFAULT_AUTO_LOCK_MINUTES = 15;

export async function getLocal(): Promise<LocalState> {
  return (await chrome.storage.local.get(null)) as LocalState;
}

export async function setLocal(patch: Partial<LocalState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

async function getSession(): Promise<SessionState> {
  return (await chrome.storage.session.get(null)) as SessionState;
}

export async function getUnlocked(): Promise<{ vaultKeyRaw: string; token?: string } | null> {
  const session = await getSession();
  if (!session.vaultKeyRaw) return null;

  // Kiểm tra hạn auto-lock ngay tại đây, không chỉ dựa vào alarm: service worker
  // của MV3 có thể bị kill và alarm trễ, nhưng popup mở ra là phải đúng.
  if (session.lockAt && Date.now() > session.lockAt) {
    await lock();
    return null;
  }
  return { vaultKeyRaw: session.vaultKeyRaw, token: session.token };
}

export async function unlock(vaultKeyRaw: string, token: string | undefined): Promise<void> {
  const { autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES } = await getLocal();
  await chrome.storage.session.set({
    vaultKeyRaw,
    token,
    lockAt: Date.now() + autoLockMinutes * 60_000,
  });
  await scheduleLockAlarm();
}

/** Gia hạn mỗi lần người dùng thao tác, để không bị khoá giữa lúc đang dùng. */
export async function touch(): Promise<void> {
  const session = await getSession();
  if (!session.vaultKeyRaw) return;
  const { autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES } = await getLocal();
  await chrome.storage.session.set({ lockAt: Date.now() + autoLockMinutes * 60_000 });
}

export async function lock(): Promise<void> {
  // `clear()` chứ không xoá từng khoá: nếu sau này thêm trường mới vào session mà
  // quên cập nhật hàm này, khoá vẫn bị xoá sạch.
  await chrome.storage.session.clear();
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.session.set({ token });
}

export const LOCK_ALARM = "auto-lock";

export async function scheduleLockAlarm(): Promise<void> {
  // Alarm tối thiểu của Chrome là 30 giây; chạy mỗi phút là đủ mịn và không tốn pin.
  await chrome.alarms.create(LOCK_ALARM, { periodInMinutes: 1 });
}
