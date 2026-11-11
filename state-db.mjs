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
  // Older installations have no revision column. Adding it preserves every value.
  if (
    !db
      .prepare('PRAGMA table_info(state)')
      .all()
      .some((column) => column.name === 'revision')
  ) {
    db.exec('ALTER TABLE state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  }
  const selectAll = db.prepare('SELECT key, value, updated_at, revision FROM state');
  const selectOne = db.prepare('SELECT value, updated_at, revision FROM state WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO state (key, value, updated_at, revision) VALUES (?, ?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
       revision = state.revision + 1`,
  );
  const insertMissing = db.prepare(
    'INSERT OR IGNORE INTO state (key, value, updated_at) VALUES (?, ?, ?)',
  );
  const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const putMeta = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      work();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    close() {
      db.close();
    },
    // { key: { value, updatedAt } }
    entries() {
      /** @type {Record<string, { value: unknown, updatedAt: number, revision: number }>} */
      const out = {};
      for (const row of selectAll.all()) {
        try {
          out[row.key] = {
            value: JSON.parse(row.value),
            updatedAt: row.updated_at,
            revision: row.revision,
          };
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
    // Each key is checked under the same write lock. An outdated client can never
    // overwrite a row; non-conflicting keys from the request still make progress.
    compareAndWrite(values, revisions) {
      /** @type {Record<string, { value: unknown, updatedAt: number, revision: number }>} */
      const entries = {};
      /** @type {Record<string, { value: unknown, updatedAt: number, revision: number }>} */
      const conflicts = {};
      transaction(() => {
        for (const [key, value] of Object.entries(values)) {
          if (!STATE_KEY.test(key)) throw new Error('Invalid state key');
          const row = selectOne.get(key);
          const revision = row?.revision ?? 0;
          if (!Number.isSafeInteger(revisions?.[key]) || revisions[key] !== revision) {
            conflicts[key] = row
              ? { value: JSON.parse(row.value), updatedAt: row.updated_at, revision }
              : { value: null, updatedAt: 0, revision: 0 };
            continue;
          }
          const updatedAt = Date.now();
          upsert.run(key, JSON.stringify(value), updatedAt);
          entries[key] = { value, updatedAt, revision: revision + 1 };
        }
      });
      return { entries, conflicts };
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
