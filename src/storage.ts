// Pure browser IndexedDB wrapper with fallback support and graceful migration

const DB_NAME = 'comfymui-db';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not supported'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore delete failure
  }
}

/**
 * Migrates existing localStorage data into IndexedDB once without deleting the original on failure.
 */
export async function migrateLocalStorageToIDB(): Promise<void> {
  if (typeof localStorage === 'undefined' || typeof indexedDB === 'undefined') return;
  try {
    const migrated = localStorage.getItem('cm-migrated-idb');
    if (migrated === 'true') return;

    // Migrate cm-jobs
    const rawJobs = localStorage.getItem('cm-jobs');
    if (rawJobs) {
      const parsedJobs = JSON.parse(rawJobs);
      if (Array.isArray(parsedJobs)) {
        await idbSet('cm-jobs', parsedJobs);
      }
    }

    // Migrate cm-presets
    const rawPresets = localStorage.getItem('cm-presets');
    if (rawPresets) {
      const parsedPresets = JSON.parse(rawPresets);
      if (Array.isArray(parsedPresets)) {
        await idbSet('cm-presets', parsedPresets);
      }
    }

    localStorage.setItem('cm-migrated-idb', 'true');
  } catch {
    /* If migration fails, keep localStorage intact */
  }
}
