import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { scenarioPromptApp } from '../scenario-prompt.mjs';
import { openStateDb } from '../state-db.mjs';

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function serve(env: Record<string, string> = {}, fetcher = vi.fn()) {
  const store = openStateDb(':memory:');
  const app = scenarioPromptApp(() => true, { store, env, fetcher });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  const call = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  return { call, fetcher, store };
}

const scene = {
  mode: 'create',
  description: 'A cat on a roof',
  style: '',
  characters: [],
  model: 'm',
};

it('falls back to the server environment until a connection is saved', async () => {
  const { call } = await serve({
    SCENARIO_AI_BASE_URL: 'http://env-host/v1',
    SCENARIO_AI_MODEL: 'env-model',
    SCENARIO_AI_API_KEY: 'env-key',
  });
  expect(await (await call('/api/settings/ai')).json()).toEqual({
    baseUrl: 'http://env-host/v1',
    model: 'env-model',
    hasKey: true,
    source: 'env',
  });
});

it('saves the connection, never returns the key and uses it for prompts', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ choices: [{ message: { content: ' Prompt text ' } }] }),
  );
  const { call } = await serve({}, fetcher);
  expect((await (await call('/api/settings/ai')).json()).source).toBe('none');
  expect((await call('/api/scenario/prompt', 'POST', scene)).status).toBe(503);

  const saved = await call('/api/settings/ai', 'PUT', {
    baseUrl: 'https://api.example.com/v1/',
    model: 'gpt-test',
    apiKey: 'sk-secret',
  });
  const view = await saved.json();
  expect(view).toEqual({
    baseUrl: 'https://api.example.com/v1/',
    model: 'gpt-test',
    hasKey: true,
    source: 'saved',
  });
  expect(JSON.stringify(view)).not.toContain('sk-secret');

  const result = await call('/api/scenario/prompt', 'POST', scene);
  expect(await result.json()).toEqual({ prompt: 'Prompt text' });
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe('https://api.example.com/v1/chat/completions');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
  expect(JSON.parse(String(init.body)).model).toBe('gpt-test');
});

it('keeps the key when omitted, removes it when empty and clears the connection', async () => {
  const { call } = await serve({ SCENARIO_AI_BASE_URL: 'http://env-host/v1' });
  await call('/api/settings/ai', 'PUT', { baseUrl: 'http://a/v1', model: 'x', apiKey: 'k' });
  let view = await (
    await call('/api/settings/ai', 'PUT', { baseUrl: 'http://a/v1', model: 'y' })
  ).json();
  expect(view).toMatchObject({ model: 'y', hasKey: true });
  view = await (
    await call('/api/settings/ai', 'PUT', { baseUrl: 'http://a/v1', model: 'y', apiKey: '' })
  ).json();
  expect(view.hasKey).toBe(false);
  view = await (await call('/api/settings/ai', 'PUT', { baseUrl: '', model: '' })).json();
  expect(view).toMatchObject({ baseUrl: 'http://env-host/v1', source: 'env' });
});

it('rejects invalid addresses and a missing model', async () => {
  const { call } = await serve();
  for (const baseUrl of ['ftp://host/v1', 'http://user:pass@host/v1', 'not a url']) {
    expect((await call('/api/settings/ai', 'PUT', { baseUrl, model: 'x' })).status).toBe(400);
  }
  expect(
    (await call('/api/settings/ai', 'PUT', { baseUrl: 'http://a/v1', model: '' })).status,
  ).toBe(400);
});

it('lists models and sends the stored key only to the saved address', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }] }),
  );
  const { call } = await serve({}, fetcher);
  await call('/api/settings/ai', 'PUT', { baseUrl: 'http://a/v1', model: 'x', apiKey: 'stored' });

  const listed = await call('/api/settings/ai/models', 'POST', { baseUrl: 'http://a/v1/' });
  expect(await listed.json()).toEqual({ models: ['a-model', 'b-model'] });
  let [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe('http://a/v1/models');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer stored');

  await call('/api/settings/ai/models', 'POST', { baseUrl: 'http://other/v1' });
  [url, init] = fetcher.mock.calls[1] as unknown as [URL, RequestInit];
  expect(String(url)).toBe('http://other/v1/models');
  expect(init.headers).toEqual({});
});

it('reports authentication failures from the model list', async () => {
  const fetcher = vi.fn(async () => new Response('no', { status: 401 }));
  const { call } = await serve({}, fetcher);
  const res = await call('/api/settings/ai/models', 'POST', { baseUrl: 'http://a/v1' });
  expect(res.status).toBe(502);
  expect((await res.json()).error.message).toContain('API 키');
});

it('explains that host.docker.internal works only inside a container', async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  });
  const { call } = await serve({}, fetcher);
  const res = await call('/api/settings/ai/models', 'POST', {
    baseUrl: 'http://host.docker.internal:47340/v1',
  });
  expect(res.status).toBe(502);
  expect((await res.json()).error.message).toContain('127.0.0.1');
});
