import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startConnection } from '../src/connection';
import { checkConnection, fetchInfo, request } from '../src/api';
import { idbGet, idbSet } from '../src/storage';
import { gzipSync } from 'node:zlib';

vi.mock('../src/storage', () => ({ idbGet: vi.fn(), idbSet: vi.fn() }));
const oldInfo = { Old: { input: { required: {} } } };
const newInfo = { New: { input: { required: {} } } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const queue = () => Response.json({ queue_running: [], queue_pending: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(idbGet).mockResolvedValue(undefined);
  vi.mocked(idbSet).mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('connection readiness', () => {
  it('becomes usable with a live health response while slow schema refresh is still pending', async () => {
    const schema = deferred<Response>();
    vi.mocked(idbGet).mockResolvedValue(oldInfo);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url.endsWith('/queue') ? Promise.resolve(queue()) : schema.promise)),
    );
    const ready = vi.fn(),
      error = vi.fn();
    const stop = startConnection('/comfy', { ready, error });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(oldInfo), { timeout: 500 });
    schema.resolve(Response.json(newInfo));
    await vi.waitFor(() => expect(ready).toHaveBeenLastCalledWith(newInfo));
    expect(error).not.toHaveBeenCalled();
    stop();
  });

  it('waits for a real health response even when schema and cache are ready', async () => {
    const health = deferred<Response>();
    vi.mocked(idbGet).mockResolvedValue(oldInfo);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/queue') ? health.promise : Promise.resolve(Response.json(newInfo)),
      ),
    );
    const ready = vi.fn(),
      error = vi.fn();
    const stop = startConnection('/comfy', { ready, error });
    await vi.waitFor(() => expect(idbSet).toHaveBeenCalled());
    expect(ready).not.toHaveBeenCalled();
    health.reject(new Error('offline'));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(ready).not.toHaveBeenCalled();
    stop();
  });

  it('does not replace fresh information with a late IndexedDB snapshot', async () => {
    const cache = deferred<typeof oldInfo>();
    vi.mocked(idbGet).mockReturnValue(cache.promise);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url.endsWith('/queue') ? queue() : Response.json(newInfo)),
      ),
    );
    const ready = vi.fn();
    const stop = startConnection('/comfy', { ready, error: vi.fn() });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(newInfo));
    cache.resolve(oldInfo);
    await cache.promise;
    expect(ready).toHaveBeenCalledTimes(1);
    stop();
  });

  it('cancels obsolete connections and ignores their late results', async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn(() => response.promise);
    vi.stubGlobal('fetch', fetcher);
    const ready = vi.fn(),
      error = vi.fn();
    const stop = startConnection('/comfy', { ready, error });
    stop();
    expect(fetcher.mock.calls).toHaveLength(2);
    response.resolve(Response.json(newInfo));
    await response.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('supports a cold connection without a cached schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url.endsWith('/queue') ? queue() : Response.json(newInfo)),
      ),
    );
    const ready = vi.fn();
    const stop = startConnection('/comfy', { ready, error: vi.fn() });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(newInfo));
    stop();
  });
});

describe('connection requests', () => {
  it('decodes the packed schema without depending on HTTP content encoding', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(gzipSync(JSON.stringify(newInfo)), {
              headers: { 'Content-Type': 'application/gzip' },
            }),
        ),
    );
    await expect(fetchInfo('/comfy')).resolves.toEqual(newInfo);
  });
  it('uses simple GET headers for direct CORS connections and propagates cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue(queue());
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await request('https://comfy.example', '/queue', { signal: controller.signal });
    const init = fetcher.mock.calls[0][1];
    expect(init.headers).toEqual({});
    controller.abort();
    expect(init.signal.aborted).toBe(true);
  });

  it('bypasses the proxy schema cache only for an explicit model refresh', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(newInfo)));
    vi.stubGlobal('fetch', fetcher);
    await fetchInfo('/comfy', undefined, true);
    expect(fetcher.mock.calls[0][0]).toBe('/comfy/object_info?packed=1&refresh=1');
    await fetchInfo('https://comfy.example', undefined, true);
    expect(fetcher.mock.calls[1][0]).toBe('https://comfy.example/object_info');
  });

  it('rejects non-ComfyUI responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    await expect(checkConnection('/comfy')).rejects.toThrow('ComfyUI');
  });
});
