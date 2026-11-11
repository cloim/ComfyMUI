import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let values: Map<string, string>;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const entry = (value: unknown, revision: number) => ({ value, revision, updatedAt: 1000 });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('versioned shared-state sync', () => {
  it('retains an offline edit baseline on reconnect and preserves both conflicting values', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 20 }, 1) } }))
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 30 }, 2) } }))
      .mockResolvedValueOnce(
        response({ entries: {}, conflicts: { 'cm-settings': entry({ steps: 30 }, 2) } }, 409),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-settings', { steps: 10 });
    await storage.fetchServerState();
    await storage.flushServerWrites();
    const sent = JSON.parse(fetch.mock.calls[2][1].body);
    expect(sent.revisions['cm-settings']).toBe(1);
    expect(storage.getSyncConflicts()).toMatchObject([
      {
        key: 'cm-settings',
        local: { steps: 10 },
        server: { steps: 30 },
        revision: 2,
      },
    ]);
    expect(storage.unsentKeys().has('cm-settings')).toBe(true);
    storage.queueServerWrite('cm-settings', { steps: 12 });
    expect(storage.getSyncConflicts()[0].local).toEqual({ steps: 12 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('merges disjoint preset edits against the current server version', async () => {
    const a = { id: 'a', name: 'A' },
      b = { id: 'b', name: 'B' };
    const local = [{ ...a, name: 'local A' }, b];
    const remote = [a, { ...b, name: 'remote B' }];
    const merged = [
      { ...a, name: 'local A' },
      { ...b, name: 'remote B' },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-presets': entry([a, b], 1) } }))
      .mockResolvedValueOnce(
        response({ entries: {}, conflicts: { 'cm-presets': entry(remote, 2) } }, 409),
      )
      .mockResolvedValueOnce(
        response({ entries: { 'cm-presets': entry(merged, 3) }, conflicts: {} }),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-presets', local);
    await storage.flushServerWrites();
    expect(storage.getSyncConflicts()).toEqual([]);
    await storage.flushServerWrites();
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      values: { 'cm-presets': merged },
      revisions: { 'cm-presets': 2 },
    });
    expect(storage.unsentKeys().size).toBe(0);
  });

  it('archives the device draft when choosing the server and permits restoring it', async () => {
    values.set(
      'cm-sync-conflicts',
      JSON.stringify([
        {
          key: 'cm-settings',
          local: { steps: 10 },
          server: { steps: 30 },
          revision: 2,
          detectedAt: 100,
        },
      ]),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 35 }, 3) } }))
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 35 }, 3) } }))
      .mockResolvedValueOnce(
        response({ entries: { 'cm-settings': entry({ steps: 10 }, 4) }, conflicts: {} }),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.resolveSyncConflict('cm-settings', 'server');
    expect(storage.getSyncConflicts()).toEqual([]);
    expect(JSON.parse(values.get('cm-settings')!)).toEqual({ steps: 35 });
    expect(storage.getSyncArchive()[0].local).toEqual({ steps: 10 });
    await storage.restoreSyncDraft(storage.getSyncArchive()[0]);
    expect(JSON.parse(fetch.mock.calls[2][1].body).revisions['cm-settings']).toBe(3);
    expect(JSON.parse(values.get('cm-settings')!)).toEqual({ steps: 10 });
    expect(storage.getSyncArchive()[0].local).toEqual({ steps: 35 });
  });

  it('adopts a missing clean key after a database reset but keeps dirty baselines', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          entries: {
            'cm-settings': entry({ steps: 20 }, 4),
            'cm-presets': entry([], 3),
          },
        }),
      )
      .mockResolvedValueOnce(response({ entries: {} }))
      .mockResolvedValueOnce(
        response(
          {
            entries: { 'cm-presets': entry([], 1) },
            conflicts: { 'cm-settings': entry(null, 0) },
          },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-settings', { steps: 25 });
    await storage.fetchServerState();
    storage.queueServerWrite('cm-presets', []);
    await storage.flushServerWrites();
    expect(JSON.parse(fetch.mock.calls[2][1].body).revisions).toEqual({
      'cm-settings': 4,
      'cm-presets': 0,
    });
    expect(storage.getSyncConflicts()[0]).toMatchObject({
      local: { steps: 25 },
      server: null,
      revision: 0,
    });
  });

  it('archives unsent current edits before restoring an older draft', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 20 }, 1) } }))
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 20 }, 1) } }))
      .mockResolvedValueOnce(
        response({ entries: { 'cm-settings': entry({ steps: 10 }, 2) }, conflicts: {} }),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-settings', { steps: 45 });
    await storage.restoreSyncDraft({
      key: 'cm-settings',
      local: { steps: 10 },
      server: { steps: 20 },
      revision: 1,
      detectedAt: 50,
    });
    expect(storage.getSyncArchive()[0].local).toEqual({ steps: 45 });
    expect(JSON.parse(fetch.mock.calls[2][1].body).values['cm-settings']).toEqual({ steps: 10 });
  });

  it('recovers pending writes and their original versions after a reload', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 20 }, 4) } }))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    let storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-settings', { steps: 42 });
    await storage.flushServerWrites();
    vi.resetModules();
    fetch.mockResolvedValueOnce(
      response({ entries: { 'cm-settings': entry({ steps: 42 }, 5) }, conflicts: {} }),
    );
    storage = await import('../src/storage');
    await storage.flushServerWrites();
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      values: { 'cm-settings': { steps: 42 } },
      revisions: { 'cm-settings': 4 },
    });
    expect(storage.unsentKeys().size).toBe(0);
  });

  it('uses the acknowledged revision for edits made while another write is in flight', async () => {
    let complete!: (result: Response) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ entries: { 'cm-settings': entry({ steps: 20 }, 1) } }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(
        response({ entries: { 'cm-settings': entry({ steps: 40 }, 3) }, conflicts: {} }),
      );
    vi.stubGlobal('fetch', fetch);
    const storage = await import('../src/storage');
    await storage.fetchServerState();
    storage.queueServerWrite('cm-settings', { steps: 30 });
    const saving = storage.flushServerWrites();
    storage.queueServerWrite('cm-settings', { steps: 40 });
    expect(JSON.parse(values.get('cm-sync-pending')!)['cm-settings']).toEqual({ steps: 40 });
    complete(response({ entries: { 'cm-settings': entry({ steps: 30 }, 2) }, conflicts: {} }));
    await saving;
    await storage.flushServerWrites();
    expect(JSON.parse(fetch.mock.calls[2][1].body).revisions['cm-settings']).toBe(2);
    expect(storage.unsentKeys().size).toBe(0);
  });
});

describe('three-way preset merging', () => {
  it('preserves deletions and new IDs but rejects overlapping edits and delete/edit conflicts', async () => {
    const { mergePresets } = await import('../src/storage');
    const a = { id: 'a', name: 'A' },
      b = { id: 'b', name: 'B' };
    expect(mergePresets([a, b], [a], [a, b, { id: 'c' }])).toEqual([a, { id: 'c' }]);
    expect(mergePresets([a], [{ ...a, name: 'local' }], [{ ...a, name: 'server' }])).toBeNull();
    expect(mergePresets([a], [], [{ ...a, name: 'server' }])).toBeNull();
    expect(mergePresets([], [a], [b])).toEqual([a, b]);
  });
});
