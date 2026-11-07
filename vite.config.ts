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
