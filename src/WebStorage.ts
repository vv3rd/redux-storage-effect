export const local = createWebStorage("local");
export const session = createWebStorage("session");

export type StorageKey = string;
export type SerializedData = string;

export interface WebStorage {
  setItem: (key: StorageKey, value: SerializedData) => void;
  getItem: (key: StorageKey) => SerializedData | null;
  removeItem: (key: StorageKey) => void;
}

function createWebStorage(type: StorageType): WebStorage {
  const storage = getStorage(type);
  return {
    getItem: (key: StorageKey) => storage.getItem(key),
    setItem: (key: StorageKey, item: SerializedData) =>
      storage.setItem(key, item),
    removeItem: (key: StorageKey) => storage.removeItem(key),
  };
}

type StorageType = "local" | "session";

function getStorage(type: StorageType): WebStorage {
  const storageType = `${type}Storage` as const;

  if (hasStorage(storageType)) {
    return self[storageType];
  } else {
    return createNoopStorage();
  }
}

function hasStorage(storageType: `${StorageType}Storage`) {
  if (typeof self !== "object" || !(storageType in self)) {
    return false;
  }

  try {
    const storage: WebStorage = self[storageType];
    const testKey = `PERSIST_TEST:${storageType}`;
    storage.setItem(testKey, "test");
    storage.getItem(testKey);
    storage.removeItem(testKey);
  } catch (error) {
    if (self.constructor.name === "Window") {
      throw error;
    } else {
      return false;
    }
  }
  return true;
}

function createNoopStorage(): WebStorage {
  if (import.meta.env.DEV) {
    console.warn(
      "[PERSISTENCE] Failed to initialize storage, noop storage will be used."
    );
  }
  return {
    getItem: _key => null,
    setItem: (_key, _value) => {},
    removeItem: _key => {},
  };
}
