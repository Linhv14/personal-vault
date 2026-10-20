import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultItem } from "../extension/lib/vault.js";

const store = new Map<string, VaultItem>();
const removeItem = vi.fn(async (id: string) => void store.delete(id));

vi.mock("../extension/lib/vault.js", () => ({
  decryptEverything: vi.fn(async () => ({ items: [...store.values()], system: [], shared: [] })),
  removeItem: (id: string) => removeItem(id),
  saveItem: vi.fn(),
}));

const { TRASH_RETENTION_DAYS, daysUntilPurge, expiredTrash, purgeExpiredTrash } =
  await import("../extension/lib/trash.js");

const DAY = 86_400;
const NOW = 1_800_000_000;

function item(id: string, extra: Partial<VaultItem> = {}): VaultItem {
  return { id, title: id, createdAt: 1, updatedAt: 1, ...extra };
}

describe("trash retention", () => {
  it("keeps items for thirty days", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it("selects personal items trashed more than thirty days ago", () => {
    const items = [
      item("live"),
      item("fresh", { trashedAt: NOW - 2 * DAY }),
      item("exactly", { trashedAt: NOW - 30 * DAY }),
      item("old", { trashedAt: NOW - 30 * DAY - 1 }),
      item("older-in-personal-vault", { trashedAt: NOW - 90 * DAY, vault: "work" }),
      item("team", { trashedAt: NOW - 90 * DAY, vault: "team:abc" }),
      item("system", { trashedAt: NOW - 90 * DAY, system: "vaults" }),
    ];
    expect(expiredTrash(items, NOW).map(({ id }) => id)).toEqual([
      "old",
      "older-in-personal-vault",
    ]);
  });

  it("counts the days left, and none for team vault items", () => {
    expect(daysUntilPurge({ trashedAt: NOW - 2 * DAY }, NOW)).toBe(28);
    expect(daysUntilPurge({ trashedAt: NOW - 30 * DAY - 5 }, NOW)).toBe(0);
    expect(daysUntilPurge({ trashedAt: NOW, vault: "team:abc" }, NOW)).toBeNull();
    expect(daysUntilPurge({}, NOW)).toBeNull();
  });
});

describe("purging expired trash", () => {
  beforeEach(() => {
    store.clear();
    removeItem.mockClear();
    for (const entry of [
      item("keep"),
      item("recent", { trashedAt: NOW - DAY }),
      item("expired-a", { trashedAt: NOW - 40 * DAY }),
      item("expired-b", { trashedAt: NOW - 31 * DAY }),
      item("team", { trashedAt: NOW - 40 * DAY, vault: "team:abc" }),
    ]) {
      store.set(entry.id, entry);
    }
  });

  it("deletes expired personal items through the normal delete path, once", async () => {
    expect(await purgeExpiredTrash({} as CryptoKey, NOW)).toBe(2);
    expect(removeItem.mock.calls.map(([id]) => id).sort()).toEqual(["expired-a", "expired-b"]);
    expect(await purgeExpiredTrash({} as CryptoKey, NOW)).toBe(0);
    expect(removeItem).toHaveBeenCalledTimes(2);
    expect([...store.keys()].sort()).toEqual(["keep", "recent", "team"]);
  });

  it("stops at the first failure and reports what it purged", async () => {
    removeItem.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    expect(await purgeExpiredTrash({} as CryptoKey, NOW)).toBe(0);
    expect(await purgeExpiredTrash({} as CryptoKey, NOW)).toBe(2);
  });
});
