/**
 * Mô hình vault phía client: giải mã cache, sync delta, lưu, xoá, và tìm item
 * khớp domain của tab đang mở.
 *
 * Việc khớp domain cố tình làm ở đây chứ không ở server. Nếu server query được
 * theo URL thì nó phải thấy URL dạng rõ — và danh sách toàn bộ site bạn có tài
 * khoản gần như có giá trị bằng chính mật khẩu.
 */

import { importVaultKey, openJson, sealJson, type SealedData } from "../../src/core/crypto.js";
import { fromBase64 } from "../../src/core/bytes.js";
import type { TotpConfig } from "../../src/core/totp.js";
import * as api from "./api.js";
import { getLocal, setLocal, type CachedItem } from "./storage.js";

export interface VaultItem {
  id: string;
  title: string;
  url?: string;
  username?: string;
  password?: string;
  totp?: TotpConfig;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export async function importKey(vaultKeyRaw: string): Promise<CryptoKey> {
  return importVaultKey(fromBase64(vaultKeyRaw));
}

/**
 * Giải mã toàn bộ cache. Một item lỗi không được làm sập cả danh sách — nếu
 * ciphertext hỏng, ta bỏ qua đúng item đó và vẫn hiện phần còn lại.
 */
export async function decryptAll(key: CryptoKey): Promise<VaultItem[]> {
  const { items = [] } = await getLocal();
  const output: VaultItem[] = [];

  for (const row of items) {
    if (row.deletedAt || !row.ciphertext || !row.nonce) continue;
    try {
      const item = await openJson<VaultItem>(key, {
        ciphertext: row.ciphertext,
        nonce: row.nonce,
      });
      output.push({ ...item, id: row.id, updatedAt: row.updatedAt });
    } catch {
      console.warn("Không giải mã được item", row.id, "— bỏ qua");
    }
  }

  return output.sort((a, b) => a.title.localeCompare(b.title, "vi"));
}

/**
 * Sync delta. Trả về số item đã thay đổi, hoặc `null` nếu không có mạng.
 *
 * Mốc `since` dùng `serverTime` của lần trước, không dùng đồng hồ máy: nếu mỗi
 * thiết bị lấy mốc theo đồng hồ riêng, một máy chạy nhanh vài giây sẽ bỏ sót
 * đúng những item vừa sửa.
 */
export async function sync(): Promise<number | null> {
  const { lastSync = 0, items = [] } = await getLocal();

  let response: { serverTime: number; items: CachedItem[] };
  try {
    response = await api.fetchItems(lastSync);
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 0) return null;
    throw error;
  }

  if (response.items.length > 0) {
    const merged = new Map(items.map((item) => [item.id, item]));
    for (const incoming of response.items) {
      const existing = merged.get(incoming.id);
      // Last-write-wins theo đồng hồ server. Với vault cá nhân, hai thiết bị sửa
      // cùng một item trong cùng một giây là trường hợp không đáng xử lý phức tạp.
      if (!existing || incoming.updatedAt >= existing.updatedAt) {
        merged.set(incoming.id, incoming);
      }
    }
    await setLocal({ items: [...merged.values()] });
  }

  await setLocal({ lastSync: response.serverTime });
  return response.items.length;
}

export async function saveItem(
  key: CryptoKey,
  item: Omit<VaultItem, "createdAt" | "updatedAt"> & { createdAt?: number },
): Promise<VaultItem> {
  const now = Math.floor(Date.now() / 1000);
  const payload: VaultItem = {
    ...item,
    createdAt: item.createdAt ?? now,
    updatedAt: now,
  };

  const sealed = await sealJson(key, payload);
  const { updatedAt } = await api.putItem(payload.id, sealed);

  await upsertCache({
    id: payload.id,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    updatedAt,
    deletedAt: null,
  });

  return { ...payload, updatedAt };
}

export async function removeItem(id: string): Promise<void> {
  const { deletedAt } = await api.deleteItem(id);
  await upsertCache({ id, ciphertext: null, nonce: null, updatedAt: deletedAt, deletedAt });
}

async function upsertCache(row: CachedItem): Promise<void> {
  const { items = [] } = await getLocal();
  const next = items.filter((item) => item.id !== row.id);
  next.push(row);
  await setLocal({ items: next });
}

export function newItemId(): string {
  // Client sinh id để tạo mới và sửa dùng chung một đường PUT — nhờ đó retry sau
  // khi mất mạng không tạo ra bản trùng.
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Khớp domain
// ---------------------------------------------------------------------------

/**
 * Lấy phần domain đáng so sánh. Không dùng Public Suffix List (nó là một file
 * vài nghìn dòng phải cập nhật định kỳ), nên chấp nhận một hạn chế đã biết:
 * `a.github.io` và `b.github.io` bị coi là cùng domain. Với vault cá nhân thì
 * hậu quả chỉ là một gợi ý không liên quan nằm trong danh sách, không phải lỗ
 * bảo mật — ta chỉ gợi ý, không tự điền vào trang.
 */
export function registrableDomain(rawUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`).hostname;
  } catch {
    return null;
  }
  const labels = hostname.replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");

  // Xử lý các đuôi hai tầng phổ biến ở Việt Nam: com.vn, edu.vn, co.uk...
  const twoPartTlds = new Set(["com", "net", "org", "edu", "gov", "co", "ac"]);
  const [, secondLast, last] = [labels.at(-3), labels.at(-2), labels.at(-1)];
  if (last && secondLast && last.length === 2 && twoPartTlds.has(secondLast)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

/** Item khớp tab hiện tại lên đầu danh sách. */
export function matchingItems(items: VaultItem[], tabUrl: string | undefined): VaultItem[] {
  if (!tabUrl) return [];
  const target = registrableDomain(tabUrl);
  if (!target) return [];
  return items.filter((item) => item.url && registrableDomain(item.url) === target);
}

export function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.title, item.username, item.url, item.totp?.issuer]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(needle)),
  );
}

export type { SealedData };
