// Loads the repo-root .env (provider keys, EVAL_* settings, DOCILE_TOKEN) so the
// eval scripts behave the same run from the repo root (turbo) or from
// packages/evals. Resolved from this file, not the cwd. Ambient/exported vars
// win — loadEnvFile never overrides what is already set.
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // No root .env — fall back to the ambient environment.
}
