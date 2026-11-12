import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import sharp from 'sharp';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { listGallery, invalidateGallery } from './gallery.mjs';
import { resolve, join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { openStateDb, STATE_KEY } from './state-db.mjs';
import { objectInfoMiddleware } from './object-info.mjs';

const app = express();
const upstream = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const stateDb = openStateDb(process.env.STATE_DB || resolve('data/comfymui.db'));
const thumbCacheDir = resolve(process.env.THUMB_CACHE_DIR || '.cache/thumbnails');
mkdirSync(thumbCacheDir, { recursive: true });

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const originHost = new URL(req.headers.origin).host;
    const directHost = req.headers.host;
    const fwdHeader = req.headers['x-forwarded-host'];
    const forwardedHost = typeof fwdHeader === 'string' ? fwdHeader.split(',')[0].trim() : null;
    return originHost === directHost || (forwardedHost !== null && originHost === forwardedHost);
  } catch {
    return false;
  }
}

function validateThumbParams(filename, subfolder, type) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }
  if (
    subfolder &&
    (typeof subfolder !== 'string' || subfolder.includes('..') || subfolder.includes('\\'))
  ) {
    return false;
  }
  if (type && !['output', 'input', 'temp'].includes(type)) {
    return false;
  }
  return true;
}

// Cache files are named <hash of the image>-<version>.webp so a reused file name with a
// new version never gets the old thumbnail, and every version can be removed together.
function thumbCacheId(filename, subfolder, type) {
  return createHash('sha256').update(`${filename}:${subfolder}:${type}`).digest('hex');
}
function thumbCachePath(filename, subfolder, type, version) {
  return join(thumbCacheDir, `${thumbCacheId(filename, subfolder, type)}-${version || 0}.webp`);
}
function removeThumbCache(filename, subfolder, type) {
  const prefix = `${thumbCacheId(filename, subfolder, type)}-`;
  for (const name of readdirSync(thumbCacheDir)) {
    if (name.startsWith(prefix)) rmSync(join(thumbCacheDir, name), { force: true });
  }
}

// ComfyUI has no file delete API, so the app server works on the output folder directly.
// It must run on the same machine as ComfyUI (or see the same folder).
let cachedOutputDir = null;
async function detectOutputDir() {
  if (process.env.COMFY_OUTPUT_DIR) {
    const dir = resolve(process.env.COMFY_OUTPUT_DIR);
    return existsSync(dir) ? dir : null;
  }
  const candidates = [];
  const read = (path) =>
    fetch(`${upstream}${path}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const [folders, stats] = await Promise.all([
    read('/internal/folder_paths'),
    read('/system_stats'),
  ]);
  const customNodes = folders?.custom_nodes?.[0];
  const comfyRoot = typeof customNodes === 'string' ? dirname(customNodes) : null;
  const argv = Array.isArray(stats?.system?.argv) ? stats.system.argv : [];
  const flag = argv.indexOf('--output-directory');
  if (flag >= 0 && typeof argv[flag + 1] === 'string') {
    candidates.push(comfyRoot ? resolve(comfyRoot, argv[flag + 1]) : resolve(argv[flag + 1]));
  }
  if (comfyRoot) candidates.push(join(comfyRoot, 'output'));
  return candidates.find((dir) => existsSync(dir)) || null;
}
async function outputDir() {
  if (!cachedOutputDir) cachedOutputDir = await detectOutputDir();
  return cachedOutputDir;
}

async function handleThumbnail(req, res) {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });

  const { filename, subfolder = '', type = 'output', v = '' } = req.query;
  if (!validateThumbParams(filename, subfolder, type) || !/^\d{0,16}$/.test(String(v))) {
    return res.status(400).json({ error: { message: '잘못된 썸네일 파라미터입니다' } });
  }

  const cachePath = thumbCachePath(filename, subfolder, type, v);

  if (existsSync(cachePath)) {
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(readFileSync(cachePath));
  }

  try {
    const viewUrl = new URL(`${upstream}/view`);
    viewUrl.searchParams.set('filename', filename);
    if (subfolder) viewUrl.searchParams.set('subfolder', subfolder);
    if (type) viewUrl.searchParams.set('type', type);

    const upstreamRes = await fetch(viewUrl, {
      headers: req.headers.origin ? { Origin: new URL(upstream).origin } : {},
      signal: AbortSignal.timeout(10000),
    });

    if (!upstreamRes.ok) {
      return res
        .status(upstreamRes.status)
        .json({ error: { message: '원본 이미지를 가져올 수 없습니다' } });
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const webpBuffer = await sharp(Buffer.from(arrayBuffer))
      .resize(320, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    writeFileSync(cachePath, webpBuffer);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(webpBuffer);
  } catch (err) {
    return res
      .status(502)
      .json({ error: { message: '썸네일 생성 중 오류가 발생했습니다: ' + err.message } });
  }
}

app.get('/api/gallery', async (req, res) => {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });
  const dir = await outputDir();
  if (!dir) return res.json({ available: false, items: [] });
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: true,
      items: await listGallery(dir, { force: req.headers['x-gallery-refresh'] === '1' }),
    });
  } catch (err) {
    res.status(500).json({ error: { message: `output 폴더를 읽을 수 없습니다: ${err.message}` } });
  }
});

app.post('/api/outputs/delete', express.json({ limit: '256kb' }), async (req, res) => {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });
  const dir = await outputDir();
  if (!dir)
    return res.status(409).json({ error: { message: 'ComfyUI output 폴더를 찾을 수 없습니다' } });
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 1000) : [];
  const result = { deleted: [], missing: [], failed: [] };
  for (const file of files) {
    const filename = file?.filename;
    const subfolder = file?.subfolder || '';
    const key = subfolder ? `${subfolder}/${filename}` : filename;
    if (file?.type !== 'output' || !validateThumbParams(filename, subfolder, 'output')) {
      result.failed.push(String(key));
      continue;
    }
    const target = resolve(dir, subfolder, filename);
    if (!target.startsWith(dir + sep)) {
      result.failed.push(key);
      continue;
    }
    try {
      await unlink(target);
      result.deleted.push(key);
    } catch (err) {
      if (err.code === 'ENOENT') result.missing.push(key);
      else result.failed.push(key);
    }
    removeThumbCache(filename, subfolder, 'output');
  }
  invalidateGallery(dir);
  res.json(result);
});

// Before the database existed, devices synced through a JSON file in ComfyUI's user
// folder. Its entries are copied in once; rows a device already wrote are kept.
let legacyImport = null;
async function importLegacyState() {
  if (stateDb.meta('legacy-import')) return;
  legacyImport ??= (async () => {
    try {
      const res = await fetch(`${upstream}/userdata/comfymui-state.json`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const entries = {};
        for (const [key, entry] of Object.entries(data?.entries || {})) {
          if (STATE_KEY.test(key) && entry && 'value' in entry) entries[key] = entry;
        }
        stateDb.importMissing(entries);
      }
      // Unreachable ComfyUI leaves the flag unset so the import runs again later.
      if (res.ok || res.status === 404) stateDb.setMeta('legacy-import', Date.now());
    } catch {
      /* ComfyUI is offline; try on the next read. */
    } finally {
      legacyImport = null;
    }
  })();
  await legacyImport;
}

app.get('/api/state', async (req, res) => {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });
  await importLegacyState();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ entries: stateDb.entries() });
});

app.post('/api/state', express.json({ limit: '8mb' }), (req, res) => {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });
  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values))
    return res.status(400).json({ error: { message: '저장할 값이 없습니다' } });
  const bad = Object.keys(values).filter((key) => !STATE_KEY.test(key));
  if (bad.length)
    return res
      .status(400)
      .json({ error: { message: `저장할 수 없는 항목입니다: ${bad.join(', ')}` } });
  const revisions = req.body?.revisions;
  if (
    !revisions ||
    typeof revisions !== 'object' ||
    Array.isArray(revisions) ||
    Object.keys(values).some((key) => !Number.isSafeInteger(revisions[key]) || revisions[key] < 0)
  ) {
    return res.status(428).json({ error: { message: '저장 전에 최신 설정을 확인해 주세요' } });
  }
  const result = stateDb.compareAndWrite(values, revisions);
  res.status(Object.keys(result.conflicts).length ? 409 : 200).json(result);
});

// Tests start each case from an empty database.
if (process.env.STATE_TEST_RESET === '1') {
  app.post('/api/state/reset', (_req, res) => {
    stateDb.reset();
    res.json({ ok: true });
  });
}

app.get('/comfy/thumb', handleThumbnail);
app.get('/comfy-thumb', handleThumbnail);

app.use('/comfy', (req, res, next) => {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });
  next();
});
// A fixed upstream prevents the app from becoming an arbitrary network proxy.
const proxy = createProxyMiddleware({
  target: upstream,
  changeOrigin: true,
  ws: false,
  proxyTimeout: 30000,
  pathRewrite: (path) => path.replace(/^\/comfy/, ''),
  on: {
    // ComfyUI checks Host and Origin together, including the port.
    proxyReq: (outgoing, req) => {
      if (req.headers.origin) outgoing.setHeader('Origin', new URL(upstream).origin);
    },
    proxyReqWs: (outgoing, req) => {
      if (req.headers.origin) outgoing.setHeader('Origin', new URL(upstream).origin);
    },
    error: (_error, _req, res) => {
      if ('writeHead' in res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ComfyUI 서버 연결을 확인해 주세요' } }));
      }
    },
  },
});
// Model downloads answer only when the file is finished, so this route has no proxy timeout.
// If the client leaves, LoRA Manager keeps downloading and the app tracks it by download id.
const downloadProxy = createProxyMiddleware({
  target: upstream,
  changeOrigin: true,
  ws: false,
  pathFilter: (path) => path.startsWith('/api/lm/download-model'),
  on: {
    proxyReq: (outgoing, req) => {
      if (req.headers.origin) outgoing.setHeader('Origin', new URL(upstream).origin);
    },
    error: (_error, _req, res) => {
      if ('writeHead' in res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'ComfyUI 서버 연결을 확인해 주세요' } }));
      }
    },
  },
});
app.use(objectInfoMiddleware(upstream, { prewarm: true }));
app.use('/comfy', downloadProxy);
app.use('/comfy', proxy);
app.use(
  express.static('dist', {
    setHeaders(res, path) {
      if (path.endsWith('sw.js') || path.endsWith('index.html'))
        res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);
app.get('/{*path}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile('dist/index.html', { root: process.cwd() });
});
const server = app.listen(Number(process.env.PORT || 4173), process.env.HOST || '0.0.0.0', () =>
  console.log('ComfyMUI ready'),
);
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/comfy/ws') || !sameOrigin(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  proxy.upgrade(req, socket, head);
});
