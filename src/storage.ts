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
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('저장이 취소되었습니다'));
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
const BASE_KEY = 'cm-sync-bases';
const CONFLICT_KEY = 'cm-sync-conflicts';
const ARCHIVE_KEY = 'cm-sync-archive';
const PENDING_KEY = 'cm-sync-pending';

type StateEntry = { value: unknown; revision: number; updatedAt?: number };
export type SyncConflict = {
  key: string;
  local: unknown;
  server: unknown;
  revision: number;
  detectedAt: number;
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The live copy remains usable if the device is full. */
  }
}
const bases: Record<string, StateEntry> = readJSON(BASE_KEY, {});
let conflicts: SyncConflict[] = readJSON(CONFLICT_KEY, []);
let archive: SyncConflict[] = readJSON(ARCHIVE_KEY, []);
const listeners = new Set<() => void>();
export const getSyncConflicts = () => conflicts;
export const getSyncArchive = () => archive;
export function subscribeSyncConflicts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publishConflicts() {
  saveJSON(CONFLICT_KEY, conflicts);
  saveJSON(ARCHIVE_KEY, archive);
  for (const listener of listeners) listener();
}
function applySharedValue(key: string, value: unknown) {
  saveJSON(key, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('comfymui:state', { detail: { key, value } }));
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A three-way merge preserves changes to different preset IDs, including deletes.
// An overlapping edit stays a visible conflict rather than guessing a winner.
export function mergePresets(base: unknown, local: unknown, server: unknown): unknown[] | null {
  if (!Array.isArray(base) || !Array.isArray(local) || !Array.isArray(server)) return null;
  const valid = (list: unknown[]) =>
    list.every((p: any) => p && typeof p.id === 'string') &&
    new Set(list.map((p: any) => p.id)).size === list.length;
  if (![base, local, server].every(valid)) return null;
  const map = (list: any[]) => new Map(list.map((p) => [p.id, p]));
  const [b, l, s] = [base, local, server].map(map);
  const ids = [
    ...new Set([
      ...local.map((p: any) => p.id),
      ...server.map((p: any) => p.id),
      ...base.map((p: any) => p.id),
    ]),
  ];
  const result: unknown[] = [];
  for (const id of ids) {
    const bv = b.get(id),
      lv = l.get(id),
      sv = s.get(id);
    if (!same(lv, bv) && !same(sv, bv) && !same(lv, sv)) return null;
    const value = same(lv, bv) ? sv : lv;
    if (value !== undefined) result.push(value);
  }
  // Preserve the application's existing preset limit; never silently discard items.
  return result.length <= 100 ? result : null;
}

const pending = new Map<string, unknown>(Object.entries(readJSON(PENDING_KEY, {})));
let inFlight = new Map<string, unknown>();
function persistPending() {
  saveJSON(PENDING_KEY, Object.fromEntries([...inFlight, ...pending]));
}
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
  return new Set([...readDirty(), ...conflicts.map((c) => c.key)]);
}

// Server values, or null when the server cannot be reached.
export async function fetchServerState(): Promise<Record<string, unknown> | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(STATE_URL, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      entries?: Record<string, StateEntry>;
    } | null;
    if (!data?.entries || typeof data.entries !== 'object') return null;
    const out: Record<string, unknown> = {};
    const dirty = unsentKeys();
    let conflictsChanged = false;
    // A reset or restored database can have removed a formerly known key.
    // Only clean keys can adopt that absence; offline edits retain their base.
    for (const key of Object.keys(bases)) {
      if (!dirty.has(key) && !(key in data.entries)) delete bases[key];
    }
    for (const [key, entry] of Object.entries(data.entries)) {
      if (!entry || !('value' in entry)) continue;
      out[key] = entry.value;
      // A dirty device must retain the version it originally edited, even after
      // reconnecting. Otherwise the next POST would conceal a concurrent edit.
      if (!dirty.has(key) && Number.isSafeInteger(entry.revision)) bases[key] = entry;
      if (Number.isSafeInteger(entry.revision) && conflicts.some((item) => item.key === key)) {
        conflicts = conflicts.map((item) =>
          item.key === key ? { ...item, server: entry.value, revision: entry.revision } : item,
        );
        conflictsChanged = true;
      }
    }
    saveJSON(BASE_KEY, bases);
    if (conflictsChanged) publishConflicts();
    return out;
  } catch {
    return null;
  }
}

export function queueServerWrite(key: string, value: unknown): void {
  const conflict = conflicts.find((item) => item.key === key);
  if (conflict) {
    conflicts = conflicts.map((item) => (item.key === key ? { ...item, local: value } : item));
    publishConflicts();
    return;
  }
  pending.set(key, value);
  persistPending();
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
  const batch = new Map([...pending].filter(([key]) => !conflicts.some((c) => c.key === key)));
  if (!batch.size) return;
  const baseline = new Map([...batch.keys()].map((key) => [key, bases[key]]));
  inFlight = batch;
  pending.clear();
  // Keep an in-flight batch durable until the response confirms it.
  flushing = (async () => {
    try {
      const res = await fetch(STATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: Object.fromEntries(batch),
          revisions: Object.fromEntries(
            [...batch.keys()].map((key) => [key, baseline.get(key)?.revision ?? 0]),
          ),
        }),
        cache: 'no-store',
        keepalive,
      });
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      const data = (await res.json()) as {
        entries: Record<string, StateEntry>;
        conflicts?: Record<string, StateEntry>;
      };
      if (!data.entries || typeof data.entries !== 'object')
        throw new Error('Invalid sync response');
      const dirty = readDirty();
      for (const [key, entry] of Object.entries(data.entries)) {
        if (!batch.has(key) || !Number.isSafeInteger(entry.revision)) continue;
        bases[key] = entry;
        if (!pending.has(key)) dirty.delete(key);
      }
      for (const [key, entry] of Object.entries(data.conflicts || {})) {
        if (!batch.has(key)) continue;
        const local = pending.has(key) ? pending.get(key) : batch.get(key);
        pending.delete(key);
        // Retrying an identical value is safe: it cannot erase another edit.
        if (same(local, entry.value)) {
          bases[key] = entry;
          dirty.delete(key);
          continue;
        }
        const merged =
          key === 'cm-presets' ? mergePresets(baseline.get(key)?.value, local, entry.value) : null;
        if (merged !== null) {
          bases[key] = entry;
          pending.set(key, merged);
          applySharedValue(key, merged);
          continue;
        }
        conflicts = [
          ...conflicts.filter((c) => c.key !== key),
          {
            key,
            local,
            server: entry.value,
            revision: entry.revision,
            detectedAt: Date.now(),
          },
        ];
      }
      saveJSON(BASE_KEY, bases);
      writeDirty(dirty);
      publishConflicts();
      // Includes automatic, disjoint preset merges and edits made during a POST.
      if (pending.size && !keepalive) flushTimer = setTimeout(() => void flushServerWrites(), 300);
    } catch {
      // Keep the values; they stay marked unsent and go out on the next flush or load.
      for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
    } finally {
      inFlight = new Map();
      persistPending();
      flushing = null;
    }
  })();
  await flushing;
}

export async function resolveSyncConflict(key: string, choice: 'local' | 'server'): Promise<void> {
  // A conflict dialog can stay open while another device continues editing.
  // Selecting the server should use its newest available version.
  if (choice === 'server') await fetchServerState();
  const conflict = conflicts.find((c) => c.key === key);
  if (!conflict) return;
  archive = [conflict, ...archive].slice(0, 20);
  conflicts = conflicts.filter((c) => c.key !== key);
  bases[key] = { value: conflict.server, revision: conflict.revision };
  saveJSON(BASE_KEY, bases);
  const value = choice === 'local' ? conflict.local : conflict.server;
  applySharedValue(key, value);
  const dirty = readDirty();
  dirty.delete(key);
  writeDirty(dirty);
  publishConflicts();
  if (choice === 'local') {
    queueServerWrite(key, value);
    await flushServerWrites();
  }
}

export async function restoreSyncDraft(
  item: SyncConflict,
  choice: 'local' | 'server' = 'local',
): Promise<void> {
  if (conflicts.some((conflict) => conflict.key === item.key)) {
    throw new Error('겹친 변경을 먼저 선택해 주세요');
  }
  // Refresh the baseline before an intentional restore; a racing writer will
  // still be detected by CAS. Offline restores keep their known revision.
  await fetchServerState();
  const value = choice === 'local' ? item.local : item.server;
  const current = pending.has(item.key)
    ? pending.get(item.key)
    : inFlight.has(item.key)
      ? inFlight.get(item.key)
      : readJSON(item.key, undefined);
  if (current !== undefined && !same(current, value)) {
    archive = [
      {
        key: item.key,
        local: current,
        server: bases[item.key]?.value ?? item.server,
        revision: bases[item.key]?.revision ?? item.revision,
        detectedAt: Date.now(),
      },
      ...archive,
    ].slice(0, 20);
    publishConflicts();
  }
  applySharedValue(item.key, value);
  queueServerWrite(item.key, value);
  await flushServerWrites();
}
