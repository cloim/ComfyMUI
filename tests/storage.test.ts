import { describe, expect, it, beforeEach } from 'vitest';
import { migrateLocalStorageToIDB } from '../src/storage';

const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.localStorage = mockLocalStorage as any;

describe('Storage migration and IDB caching', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps localStorage intact when indexedDB is unavailable', async () => {
    const sampleJobs = [{ id: 'job-1', createdAt: 1234, settings: { positive: 'test' } }];
    const samplePresets = [{ id: 'pre-1', name: 'Preset 1' }];

    localStorage.setItem('cm-jobs', JSON.stringify(sampleJobs));
    localStorage.setItem('cm-presets', JSON.stringify(samplePresets));

    await migrateLocalStorageToIDB();

    // Verify localStorage data remains intact without deletion
    expect(JSON.parse(localStorage.getItem('cm-jobs')!)).toEqual(sampleJobs);
    expect(JSON.parse(localStorage.getItem('cm-presets')!)).toEqual(samplePresets);
  });

  it('handles empty or corrupt localStorage gracefully without throwing', async () => {
    localStorage.setItem('cm-jobs', 'invalid-json{{{');
    await expect(migrateLocalStorageToIDB()).resolves.toBeUndefined();
    // Corrupt data must not be wiped out
    expect(localStorage.getItem('cm-jobs')).toBe('invalid-json{{{');
  });
});
