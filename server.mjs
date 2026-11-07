import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
const app = express();
const upstream = process.env.COMFY_URL || 'http://127.0.0.1:8188';
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}
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
