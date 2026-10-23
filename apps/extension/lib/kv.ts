// Minimal key-value abstraction so the report cache logic can be unit-tested
// without the chrome.* APIs.
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export function chromeKV(area: chrome.storage.StorageArea): KV {
  return {
    async get<T>(key: string) {
      const got = await area.get(key);
      return got[key] as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await area.set({ [key]: value });
    },
    async remove(key: string) {
      await area.remove(key);
    },
  };
}

export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, structuredClone(value));
    },
    async remove(key: string) {
      data.delete(key);
    },
  };
}
