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

// Shared state lives in the app server's SQLite database. The browser keeps a copy in
// localStorage for instant start and offline use; the server copy wins on load unless
// this device has changes it could not send yet.
const STATE_URL = '/api/state';
const DIRTY_KEY = 'cm-unsent-keys';

const pending = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function readDirty(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeDirty(keys: Set<string>) {
  try {
    if (keys.size) localStorage.setItem(DIRTY_KEY, JSON.stringify([...keys]));
    else localStorage.removeItem(DIRTY_KEY);
  } catch {
    /* ignore */
  }
}

// Keys changed on this device that the server has not confirmed yet.
export function unsentKeys(): Set<string> {
  return readDirty();
}

// Server values, or null when the server cannot be reached.
export async function fetchServerState(): Promise<Record<string, unknown> | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(STATE_URL, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      entries?: Record<string, { value: unknown }>;
    } | null;
    if (!data?.entries || typeof data.entries !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(data.entries)) {
      if (entry && 'value' in entry) out[key] = entry.value;
    }
    return out;
  } catch {
    return null;
  }
}

export function queueServerWrite(key: string, value: unknown): void {
  pending.set(key, value);
  const dirty = readDirty();
  if (!dirty.has(key)) {
    dirty.add(key);
    writeDirty(dirty);
  }
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushServerWrites(), 300);
}

export async function flushServerWrites(keepalive = false): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushing) await flushing;
  if (!pending.size || typeof fetch === 'undefined') return;
  const batch = new Map(pending);
  pending.clear();
  flushing = (async () => {
    try {
      const res = await fetch(STATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: Object.fromEntries(batch) }),
        cache: 'no-store',
        keepalive,
      });
      if (!res.ok) throw new Error(String(res.status));
      const dirty = readDirty();
      for (const key of batch.keys()) if (!pending.has(key)) dirty.delete(key);
      writeDirty(dirty);
    } catch {
      // Keep the values; they stay marked unsent and go out on the next flush or load.
      for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
    } finally {
      flushing = null;
    }
  })();
  await flushing;
}
