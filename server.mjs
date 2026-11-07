import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import sharp from 'sharp';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const app = express();
const upstream = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const thumbCacheDir = resolve('.cache/thumbnails');
mkdirSync(thumbCacheDir, { recursive: true });

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function validateThumbParams(filename, subfolder, type) {
  if (typeof filename !== 'string' || !filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  if (subfolder && (typeof subfolder !== 'string' || subfolder.includes('..') || subfolder.includes('\\'))) {
    return false;
  }
  if (type && !['output', 'input', 'temp'].includes(type)) {
    return false;
  }
  return true;
}

async function handleThumbnail(req, res) {
  if (!sameOrigin(req))
    return res.status(403).json({ error: { message: '같은 앱 주소에서 요청해 주세요' } });

  const { filename, subfolder = '', type = 'output' } = req.query;
  if (!validateThumbParams(filename, subfolder, type)) {
    return res.status(400).json({ error: { message: '잘못된 썸네일 파라미터입니다' } });
  }

  const cacheKey = createHash('sha256').update(`${filename}:${subfolder}:${type}`).digest('hex') + '.webp';
  const cachePath = join(thumbCacheDir, cacheKey);

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
      return res.status(upstreamRes.status).json({ error: { message: '원본 이미지를 가져올 수 없습니다' } });
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
    return res.status(502).json({ error: { message: '썸네일 생성 중 오류가 발생했습니다: ' + err.message } });
  }
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
app.use('/comfy', proxy);
app.use(
  express.static('dist', {
    setHeaders(res, path) {
      if (path.endsWith('sw.js') || path.endsWith('index.html'))
        res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);
app.get('/{*path}', (_req, res) => res.sendFile('dist/index.html', { root: process.cwd() }));
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
