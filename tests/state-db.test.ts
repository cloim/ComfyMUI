import { describe, it, expect } from 'vitest';
import { openStateDb, STATE_KEY } from '../state-db.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('state database', () => {
  it('migrates a pre-revision database without changing settings, presets or timestamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'comfymui-legacy-db-'));
    const file = join(dir, 'state.db');
    const old = new DatabaseSync(file);
    old.exec(
      'CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
    );
    old
      .prepare('INSERT INTO state VALUES (?, ?, ?)')
      .run('cm-settings', JSON.stringify({ steps: 24 }), 123);
    old
      .prepare('INSERT INTO state VALUES (?, ?, ?)')
      .run('cm-presets', JSON.stringify([{ id: 'kept', name: 'Saved' }]), 456);
    old.close();
    const db = openStateDb(file);
    try {
      expect(db.entries()['cm-settings']).toEqual({
        value: { steps: 24 },
        updatedAt: 123,
        revision: 1,
      });
      expect(db.entries()['cm-presets']).toEqual({
        value: [{ id: 'kept', name: 'Saved' }],
        updatedAt: 456,
        revision: 1,
      });
      expect(
        db.compareAndWrite({ 'cm-settings': { steps: 28 } }, { 'cm-settings': 1 }).entries[
          'cm-settings'
        ].revision,
      ).toBe(2);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects stale versions while accepting unrelated keys', () => {
    const db = openStateDb(':memory:');
    const first = db.compareAndWrite({ 'cm-settings': { steps: 20 } }, { 'cm-settings': 0 });
    expect(first.entries['cm-settings'].revision).toBe(1);
    expect(first.conflicts).toEqual({});
    const second = db.compareAndWrite({ 'cm-settings': { steps: 30 } }, { 'cm-settings': 1 });
    expect(second.entries['cm-settings'].revision).toBe(2);
    const stale = db.compareAndWrite(
      { 'cm-settings': { steps: 10 }, 'cm-presets': [] },
      { 'cm-settings': 1, 'cm-presets': 0 },
    );
    expect(stale.conflicts['cm-settings']).toMatchObject({ value: { steps: 30 }, revision: 2 });
    expect(stale.entries['cm-presets'].revision).toBe(1);
    expect(db.entries()['cm-settings'].value).toEqual({ steps: 30 });
  });

  it('never overwrites existing data when a client omits its version', () => {
    const db = openStateDb(':memory:');
    db.write({ 'cm-settings': 'saved' });
    const result = db.compareAndWrite({ 'cm-settings': 'outdated client' }, {});
    expect(result.conflicts['cm-settings'].value).toBe('saved');
    expect(db.entries()['cm-settings'].value).toBe('saved');
  });

  it('stores JSON values per key and replaces them on write', () => {
    const db = openStateDb(':memory:');
    db.write({ 'cm-settings': { steps: 24 }, 'cm-presets': [] });
    db.write({ 'cm-settings': { steps: 30 } });
    const entries = db.entries();
    expect(entries['cm-settings'].value).toEqual({ steps: 30 });
    expect(entries['cm-presets'].value).toEqual([]);
    expect(typeof entries['cm-settings'].updatedAt).toBe('number');
  });

  it('imports legacy entries only where the database has no row', () => {
    const db = openStateDb(':memory:');
    db.write({ 'cm-default-prompts': ['current'] });
    db.importMissing({
      'cm-default-prompts': { value: ['old'], updatedAt: 1 },
      'cm-model-order': { value: ['a'], updatedAt: 1 },
    });
    expect(db.entries()['cm-default-prompts'].value).toEqual(['current']);
    expect(db.entries()['cm-model-order'].value).toEqual(['a']);
    db.setMeta('legacy-import', 1);
    expect(db.meta('legacy-import')).toBe('1');
    db.reset();
    expect(db.entries()).toEqual({});
    expect(db.meta('legacy-import')).toBeNull();
  });

  it('accepts only app keys', () => {
    expect(STATE_KEY.test('cm-example-defaults')).toBe(true);
    for (const key of ['settings', 'cm-', 'cm-Settings', 'cm-a/b', `cm-${'x'.repeat(61)}`])
      expect(STATE_KEY.test(key)).toBe(false);
  });
});
