import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Pricing } from '@ratchaw/extractkit';
import type { EvalModel } from './types.js';

export type Provider = 'anthropic' | 'openai' | 'google';

export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google'];

interface CatalogEntry {
  /** Display name used in reports; also the provider's model id. */
  name: string;
  pricing: Pricing;
}

interface ProviderSpec {
  /** Env var the AI SDK provider reads for its API key. */
  apiKeyEnv: string;
  create: (modelId: string) => LanguageModel;
  models: CatalogEntry[];
}

/**
 * The benchmark lineup: vision-capable tiers per provider (flagship →
 * cost-efficient) so they accept the receipt/invoice image and PDF inputs.
 * Pricing is the standard per-MTok list price from each provider's public
 * pricing page as of 2026-07 (sourced inline). Published cost numbers use the
 * durable list price, not promotional rates, so they don't expire.
 */
const CATALOG: Record<Provider, ProviderSpec> = {
  // platform.claude.com/docs/en/pricing
  anthropic: {
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    create: (id) => anthropic(id),
    models: [
      { name: 'claude-opus-4-8', pricing: { inputPerMTokUSD: 5, outputPerMTokUSD: 25 } },
      { name: 'claude-sonnet-5', pricing: { inputPerMTokUSD: 3, outputPerMTokUSD: 15 } },
      { name: 'claude-haiku-4-5', pricing: { inputPerMTokUSD: 1, outputPerMTokUSD: 5 } },
    ],
  },
  // developers.openai.com/api/docs/pricing
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    create: (id) => openai(id),
    models: [
      { name: 'gpt-5.6-sol', pricing: { inputPerMTokUSD: 5, outputPerMTokUSD: 30 } },
      { name: 'gpt-5.6-luna', pricing: { inputPerMTokUSD: 1, outputPerMTokUSD: 6 } },
      { name: 'gpt-5.4-mini', pricing: { inputPerMTokUSD: 0.75, outputPerMTokUSD: 4.5 } },
    ],
  },
  // ai.google.dev/gemini-api/docs/pricing (standard rate, <=200k-token context)
  google: {
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    create: (id) => google(id),
    models: [
      { name: 'gemini-3.5-flash', pricing: { inputPerMTokUSD: 1.5, outputPerMTokUSD: 9 } },
      { name: 'gemini-2.5-pro', pricing: { inputPerMTokUSD: 1.25, outputPerMTokUSD: 10 } },
      { name: 'gemini-2.5-flash', pricing: { inputPerMTokUSD: 0.3, outputPerMTokUSD: 2.5 } },
      { name: 'gemini-2.5-flash-lite', pricing: { inputPerMTokUSD: 0.1, outputPerMTokUSD: 0.4 } },
    ],
  },
};

function parseProviders(raw: string): Provider[] {
  const names = raw.split(/[,\s]+/).filter((s) => s.length > 0);
  const selected: Provider[] = [];
  for (const name of names) {
    if (!PROVIDERS.includes(name as Provider)) {
      throw new Error(`Unknown provider "${name}" in EVAL_PROVIDERS; valid values are ${PROVIDERS.join(', ')}.`);
    }
    if (!selected.includes(name as Provider)) selected.push(name as Provider);
  }
  if (selected.length === 0) {
    throw new Error(`EVAL_PROVIDERS is empty; set it to a comma-separated subset of ${PROVIDERS.join(', ')}.`);
  }
  return selected;
}

/**
 * A provider counts as configured only when its API key is a non-empty string,
 * matching the playground's model resolver. A blank `KEY=` line in a `.env`
 * therefore reads as unset instead of triggering a doomed run against a provider
 * with no credential.
 */
function hasApiKey(env: NodeJS.ProcessEnv, provider: Provider): boolean {
  const value = env[CATALOG[provider].apiKeyEnv];
  return value !== undefined && value !== '';
}

/**
 * Which providers to benchmark. `EVAL_PROVIDERS` selects them explicitly
 * (comma-separated, e.g. `openai` or `openai,google`); each named provider
 * must have its API key set. When unset (or blank), every provider whose API
 * key is present runs — so setting only `OPENAI_API_KEY` benchmarks OpenAI
 * alone. An empty key value counts as absent, same as the playground.
 */
export function selectProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const raw = env['EVAL_PROVIDERS'];
  if (raw !== undefined && raw.trim() !== '') {
    const requested = parseProviders(raw);
    const missing = requested.filter((p) => !hasApiKey(env, p));
    if (missing.length > 0) {
      const detail = missing.map((p) => `${p} (${CATALOG[p].apiKeyEnv})`).join(', ');
      throw new Error(`Missing API key for selected provider(s): ${detail}.`);
    }
    return requested;
  }
  const available = PROVIDERS.filter((p) => hasApiKey(env, p));
  if (available.length === 0) {
    const keys = PROVIDERS.map((p) => CATALOG[p].apiKeyEnv).join(', ');
    throw new Error(`No provider API key found; set one of ${keys}, or pick providers with EVAL_PROVIDERS.`);
  }
  return available;
}

function parseModelFilter(raw: string): string[] {
  const names = raw.split(/[,\s]+/).filter((s) => s.length > 0);
  const selected: string[] = [];
  for (const name of names) {
    if (!selected.includes(name)) selected.push(name);
  }
  return selected;
}

/**
 * The models to run this benchmark, resolved from the selected providers.
 * `EVAL_MODELS` narrows the lineup to specific models by name (comma-separated,
 * e.g. `gemini-3.5-flash`); every named model must belong to a selected
 * provider. When unset (or blank) all of the selected providers' models run.
 * A model name that resolves to a provider without an API key never appears in
 * the available set, so filtering to it is rejected with a clear error.
 */
export function benchmarkModels(env: NodeJS.ProcessEnv = process.env): EvalModel[] {
  const models = selectProviders(env).flatMap((provider) => {
    const spec = CATALOG[provider];
    return spec.models.map((m) => ({ name: m.name, model: spec.create(m.name), pricing: m.pricing }));
  });

  const raw = env['EVAL_MODELS'];
  if (raw === undefined || raw.trim() === '') return models;

  const requested = parseModelFilter(raw);
  const available = new Set(models.map((m) => m.name));
  const missing = requested.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(
      `EVAL_MODELS names model(s) not available from the selected providers: ${missing.join(', ')}. ` +
        `Available: ${[...available].join(', ')}.`,
    );
  }
  return models.filter((m) => requested.includes(m.name));
}
