// Shared app state (settings, presets, classifications) in one SQLite file.
// Every device reads and writes here, so the server copy is the single source of truth.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATE_KEY = /^cm-[a-z0-9-]{1,60}$/;

export function openStateDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const selectAll = db.prepare('SELECT key, value, updated_at FROM state');
  const upsert = db.prepare(
    `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const insertMissing = db.prepare(
    'INSERT OR IGNORE INTO state (key, value, updated_at) VALUES (?, ?, ?)',
  );
  const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const putMeta = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  function transaction(work) {
    db.exec('BEGIN');
    try {
      work();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    // { key: { value, updatedAt } }
    entries() {
      /** @type {Record<string, { value: unknown, updatedAt: number }>} */
      const out = {};
      for (const row of selectAll.all()) {
        try {
          out[row.key] = { value: JSON.parse(row.value), updatedAt: row.updated_at };
        } catch {
          // A broken row is skipped; the next write from a device replaces it.
        }
      }
      return out;
    },
    // Writes the given values and returns the stored time.
    write(values) {
      const now = Date.now();
      transaction(() => {
        for (const [key, value] of Object.entries(values)) {
          upsert.run(key, JSON.stringify(value), now);
        }
      });
      return now;
    },
    // Keeps rows that already exist; used for the one-time legacy import.
    importMissing(entries) {
      transaction(() => {
        for (const [key, entry] of Object.entries(entries)) {
          insertMissing.run(key, JSON.stringify(entry.value), entry.updatedAt || Date.now());
        }
      });
    },
    meta(key) {
      return getMeta.get(key)?.value ?? null;
    },
    setMeta(key, value) {
      putMeta.run(key, String(value));
    },
    reset() {
      db.exec('DELETE FROM state; DELETE FROM meta;');
    },
  };
}
