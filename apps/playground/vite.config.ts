import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The client is a static SPA served by Vite in dev and by the Hono server in
// prod. In dev, /api is proxied to the Hono server so the browser sees one
// origin. PORT is read from the same .env the server loads, so they stay in sync.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env['PORT'] ?? '8787';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
    },
  };
});
