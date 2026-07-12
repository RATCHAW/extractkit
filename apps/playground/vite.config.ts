import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The client is a static SPA served by Vite in dev and by the Hono server in
// prod. In dev, /api is proxied to the Hono server so the browser sees one
// origin. PORT is read from the repo-root .env the server loads (resolved from
// this file, not the cwd, so it works when run via turbo), keeping them in sync.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env['PORT'] ?? '8787';
  return {
    plugins: [react()],
    envDir: repoRoot,
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
