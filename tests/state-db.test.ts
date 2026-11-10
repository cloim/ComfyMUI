import { describe, it, expect } from 'vitest';
import { openStateDb, STATE_KEY } from '../state-db.mjs';

describe('state database', () => {
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
