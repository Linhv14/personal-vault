export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface Platform {
  local: StorageArea;
  session: StorageArea;
  scheduleLock(alarm: string): Promise<void>;
}

const extension = (): Platform => ({
  local: chrome.storage.local,
  session: chrome.storage.session,
  scheduleLock: async (alarm) => {
    await chrome.alarms.create(alarm, { periodInMinutes: 1 });
  },
});

let current: Platform | null = null;

export function platform(): Platform {
  return current ?? extension();
}

export function usePlatform(next: Platform): void {
  current = next;
}

export function memoryArea(initial: Record<string, unknown> = {}): StorageArea {
  const store = new Map(Object.entries(initial));
  return {
    get: async (keys) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const wanted = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(
        wanted.filter((key) => store.has(key)).map((key) => [key, store.get(key)]),
      );
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
    remove: async (keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        store.delete(key);
      }
    },
    clear: async () => store.clear(),
  };
}
