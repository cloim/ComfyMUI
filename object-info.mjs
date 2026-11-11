import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);

// One bounded cache per fixed upstream, shared by all devices. Keep every node and
// its validation schema; descriptions and editor metadata are not used by this app.
export function objectInfoMiddleware(
  upstream,
  { ttlMs = 30000, fetcher = fetch, prewarm = false } = {},
) {
  let cached;
  let pending;
  async function load() {
    const response = await fetcher(`${upstream}/object_info`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`ComfyUI 노드 조회 실패 (${response.status})`);
    const info = await response.json();
    if (!info || !Object.values(info).some((node) => node?.input))
      throw new Error('ComfyUI 노드 정보를 확인해 주세요');
    const json = Buffer.from(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(info).map(([name, node]) => [
            name,
            {
              input: node.input,
              output: node.output,
              output_node: node.output_node,
            },
          ]),
        ),
      ),
    );
    const zipped = await compress(json);
    cached = { json, zipped, expiresAt: Date.now() + ttlMs };
    return cached;
  }
  function refresh() {
    pending ??= load().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  // Start the expensive first scan before a person opens the app.
  if (prewarm) void refresh().catch(() => {});
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/comfy/object_info') return next();
    try {
      if (!cached || url.searchParams.has('refresh')) await refresh();
      else if (cached.expiresAt <= Date.now()) void refresh().catch(() => {});
      // An explicit gzip representation survives intermediaries that decompress
      // HTTP Content-Encoding. The app decodes it with DecompressionStream.
      const packed = url.searchParams.get('packed') === '1';
      const zipped = !packed && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = packed || zipped ? cached.zipped : cached.json;
      res.setHeader(
        'Content-Type',
        packed ? 'application/gzip' : 'application/json; charset=utf-8',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Accept-Encoding');
      if (zipped) res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', body.length);
      res.end(body);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  };
}
