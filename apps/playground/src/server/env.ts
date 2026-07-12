// Loads the repo-root .env (provider keys, PORT) so the server behaves the same
// started from the repo root (turbo) or from apps/playground. Resolved from this
// file, not the cwd. In deployment the file is absent and the vars come from the
// real environment; anything already set there wins over the file.
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // No root .env — fall back to the ambient environment.
}
