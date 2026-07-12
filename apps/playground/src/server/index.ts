import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { resolveModels } from './models';

// Load a local .env if present; in deployment the vars come from the real env.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — fall back to the ambient environment.
}

const models = resolveModels();
const app = createApp({ models });

// In production the Hono server also serves the built client (same origin as
// the API). In dev the Vite server serves the client and proxies /api here.
if (process.env['NODE_ENV'] === 'production') {
  app.use('/*', serveStatic({ root: './dist/client' }));
  app.get('*', serveStatic({ path: './dist/client/index.html' }));
}

const port = Number(process.env['PORT'] ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`extractkit playground → http://localhost:${info.port}`);
  if (models.length === 0) {
    console.warn(
      'No provider API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or ' +
        'GOOGLE_GENERATIVE_AI_API_KEY to enable extraction.',
    );
  } else {
    console.log(`Models available: ${models.map((m) => m.id).join(', ')}`);
  }
});
