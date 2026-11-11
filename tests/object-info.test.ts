import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { objectInfoMiddleware } from '../object-info.mjs';
import { gunzipSync } from 'node:zlib';

const schema = {
  CustomNode: {
    input: { required: { steps: ['INT', { min: 1, max: 50 }], file: [['model.safetensors']] } },
    output: ['IMAGE'],
    output_node: true,
    description: 'x'.repeat(100000),
  },
};
let server: Server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function serve(fetcher: typeof fetch, ttlMs = 30000) {
  const middleware = objectInfoMiddleware('http://fixed-upstream', { fetcher, ttlMs });
  server = createServer(
    (req, res) =>
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}/comfy/object_info`;
}

it('compresses all node schemas while preserving model options and validation constraints', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(schema));
  const url = await serve(fetcher);
  const response = await fetch(url);
  expect(response.headers.get('content-encoding')).toBe('gzip');
  expect(Number(response.headers.get('content-length'))).toBeLessThan(500);
  expect(await response.json()).toEqual({
    CustomNode: {
      input: schema.CustomNode.input,
      output: ['IMAGE'],
      output_node: true,
    },
  });
  expect(fetcher.mock.calls[0][0]).toBe('http://fixed-upstream/object_info');
});

it('coalesces simultaneous requests, reuses the cache and refreshes on explicit request', async () => {
  const fetcher = vi.fn().mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return Response.json(schema);
  });
  const url = await serve(fetcher);
  await Promise.all(Array.from({ length: 5 }, () => fetch(url).then((r) => r.json())));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await (await fetch(url)).json();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await (await fetch(url + '?refresh=1')).json();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps the explicit gzip representation compressed even with identity HTTP encoding', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(schema));
  const url = await serve(fetcher);
  const response = await fetch(url + '?packed=1', { headers: { 'Accept-Encoding': 'identity' } });
  expect(response.headers.get('content-type')).toBe('application/gzip');
  expect(response.headers.get('content-encoding')).toBeNull();
  const body = Buffer.from(await response.arrayBuffer());
  expect(body.length).toBeLessThan(500);
  expect(JSON.parse(gunzipSync(body).toString()).CustomNode.input).toEqual(schema.CustomNode.input);
});

it('expires the cache and does not reuse a failed upstream response', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
    .mockImplementation(async () => Response.json(schema));
  const url = await serve(fetcher, 0);
  expect((await fetch(url)).status).toBe(502);
  expect((await fetch(url)).status).toBe(200);
  expect((await fetch(url)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('serves an expired snapshot immediately while one background refresh is pending', async () => {
  let finish!: (response: Response) => void;
  const updating = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetcher = vi
    .fn()
    .mockImplementationOnce(async () => Response.json(schema))
    .mockImplementation(async () => (await updating).clone());
  const url = await serve(fetcher, 0);
  await (await fetch(url)).json();
  expect((await (await fetch(url)).json()).CustomNode.input).toEqual(schema.CustomNode.input);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const forced = fetch(url + '?refresh=1');
  finish(Response.json({ Updated: schema.CustomNode }));
  expect(await (await forced).json()).toHaveProperty('Updated');
});
