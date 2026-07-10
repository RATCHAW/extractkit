import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Pricing } from 'extractkit';
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
 * The benchmark lineup: three tiers per provider (flagship → cost-efficient),
 * all vision-capable so they accept the receipt/invoice image and PDF inputs.
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
 * Which providers to benchmark. `EVAL_PROVIDERS` selects them explicitly
 * (comma-separated, e.g. `openai` or `openai,google`); each named provider
 * must have its API key set. When unset, every provider whose API key is
 * present runs — so setting only `OPENAI_API_KEY` benchmarks OpenAI alone.
 */
export function selectProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const raw = env['EVAL_PROVIDERS'];
  if (raw !== undefined) {
    const requested = parseProviders(raw);
    const missing = requested.filter((p) => env[CATALOG[p].apiKeyEnv] === undefined);
    if (missing.length > 0) {
      const detail = missing.map((p) => `${p} (${CATALOG[p].apiKeyEnv})`).join(', ');
      throw new Error(`Missing API key for selected provider(s): ${detail}.`);
    }
    return requested;
  }
  const available = PROVIDERS.filter((p) => env[CATALOG[p].apiKeyEnv] !== undefined);
  if (available.length === 0) {
    const keys = PROVIDERS.map((p) => CATALOG[p].apiKeyEnv).join(', ');
    throw new Error(`No provider API key found; set one of ${keys}, or pick providers with EVAL_PROVIDERS.`);
  }
  return available;
}

/** The models to run this benchmark, resolved from the selected providers. */
export function benchmarkModels(env: NodeJS.ProcessEnv = process.env): EvalModel[] {
  return selectProviders(env).flatMap((provider) => {
    const spec = CATALOG[provider];
    return spec.models.map((m) => ({ name: m.name, model: spec.create(m.name), pricing: m.pricing }));
  });
}
