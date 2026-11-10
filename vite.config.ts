import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'dev-thumbnail-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url || '', 'http://localhost');
          if (url.pathname !== '/comfy/thumb' && url.pathname !== '/comfy-thumb') {
            return next();
          }
          const filename = url.searchParams.get('filename') || '';
          const subfolder = url.searchParams.get('subfolder') || '';
          const type = url.searchParams.get('type') || 'output';
          if (
            !filename ||
            filename.includes('..') ||
            filename.includes('/') ||
            filename.includes('\\')
          ) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: { message: '잘못된 썸네일 파라미터입니다' } }));
          }
          try {
            const upstream = process.env.COMFY_URL || 'http://127.0.0.1:8188';
            const viewUrl = new URL(`${upstream}/view`);
            viewUrl.searchParams.set('filename', filename);
            if (subfolder) viewUrl.searchParams.set('subfolder', subfolder);
            if (type) viewUrl.searchParams.set('type', type);
            const upstreamRes = await fetch(viewUrl, { signal: AbortSignal.timeout(10000) });
            if (!upstreamRes.ok) {
              res.statusCode = upstreamRes.status;
              return res.end(
                JSON.stringify({ error: { message: '원본 이미지를 가져올 수 없습니다' } }),
              );
            }
            const sharp = (await import('sharp')).default;
            const buffer = await upstreamRes.arrayBuffer();
            const webp = await sharp(Buffer.from(buffer))
              .resize(320, null, { withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.end(webp);
          } catch (e: any) {
            res.statusCode = 502;
            return res.end(JSON.stringify({ error: { message: e.message } }));
          }
        });
      },
    },
    {
      name: 'offline-app-shell',
      writeBundle(_options, bundle) {
        const files = [
          '/index.html',
          '/icon.svg',
          '/icon-192.png',
          '/icon-512.png',
          '/sample.svg',
          '/manifest.webmanifest',
          ...Object.keys(bundle)
            .filter((p) => p.startsWith('assets/'))
            .map((p) => '/' + p),
        ];
        const hash = createHash('sha256').update(readFileSync('public/sw.js'));
        for (const path of files) hash.update(path).update(readFileSync('dist' + path));
        const version = hash.digest('hex').slice(0, 12);
        const sw = readFileSync('public/sw.js', 'utf8')
          .replace('__CACHE_VERSION__', `comfymui-${version}`)
          .replace('__PRECACHE__', JSON.stringify(files));
        writeFileSync('dist/sw.js', sw);
      },
    },
  ],
  server: {
    proxy: {
      '/comfy': {
        target: process.env.COMFY_URL || 'http://127.0.0.1:8188',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/comfy/, ''),
        configure(proxy) {
          const rewriteOrigin = (
            outgoing: { setHeader: (key: string, value: string) => void },
            req: { headers: { origin?: string; host?: string } },
          ) => {
            if (!req.headers.origin) return;
            try {
              if (new URL(req.headers.origin).host === req.headers.host)
                outgoing.setHeader(
                  'Origin',
                  new URL(process.env.COMFY_URL || 'http://127.0.0.1:8188').origin,
                );
            } catch {
              /* Keep an invalid origin for the backend to reject. */
            }
          };
          proxy.on('proxyReq', rewriteOrigin);
          proxy.on('proxyReqWs', rewriteOrigin);
        },
      },
    },
  },
});
