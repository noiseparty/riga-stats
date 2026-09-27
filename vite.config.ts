import { defineConfig } from 'vite';

const BASE = '/demo/riga/';
const API_PORT = Number(process.env.PORT ?? 3104);

export default defineConfig({
  base: BASE,
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      // The shell serves /theme.css on the same origin in production.
      '/theme.css': { target: 'https://www.skabene.id.lv', changeOrigin: true, secure: true },
      // `pnpm dev:server` runs the real API on PORT.
      [`${BASE}api`]: { target: `http://127.0.0.1:${API_PORT}` },
    },
  },
});
