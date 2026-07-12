import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Pricing } from 'extractkit';
import type { ModelInfo } from '../shared/api';

/** A model the playground can run, plus how to build it and price it. */
export interface PlaygroundModel {
  id: string;
  label: string;
  provider: string;
  pricing: Pricing;
  create: () => LanguageModel;
}

interface CatalogEntry {
  /** Provider model id, also used as the client-facing id. */
  id: string;
  label: string;
  provider: string;
  /** Env var the AI SDK provider reads for its key; gates availability. */
  apiKeyEnv: string;
  create: (id: string) => LanguageModel;
  pricing: Pricing;
}

/**
 * A demo-sized lineup: a strong and a cost-efficient model per provider, all
 * vision-capable. Pricing is the public per-MTok list price (2026-07), matching
 * the eval harness catalog, so the cost the playground shows is real.
 */
const CATALOG: CatalogEntry[] = [
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    create: (id) => anthropic(id),
    pricing: { inputPerMTokUSD: 3, outputPerMTokUSD: 15 },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    create: (id) => anthropic(id),
    pricing: { inputPerMTokUSD: 1, outputPerMTokUSD: 5 },
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    create: (id) => openai(id),
    pricing: { inputPerMTokUSD: 1, outputPerMTokUSD: 6 },
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    provider: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    create: (id) => openai(id),
    pricing: { inputPerMTokUSD: 0.75, outputPerMTokUSD: 4.5 },
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'google',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    create: (id) => google(id),
    pricing: { inputPerMTokUSD: 1.5, outputPerMTokUSD: 9 },
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    create: (id) => google(id),
    pricing: { inputPerMTokUSD: 0.3, outputPerMTokUSD: 2.5 },
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    provider: 'google',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    create: (id) => google(id),
    pricing: { inputPerMTokUSD: 0.1, outputPerMTokUSD: 0.4 },
  },
];

/** The models runnable in this environment: those whose provider key is set. */
export function resolveModels(env: NodeJS.ProcessEnv = process.env): PlaygroundModel[] {
  return CATALOG.filter((entry) => {
    const key = env[entry.apiKeyEnv];
    return key !== undefined && key !== '';
  }).map((entry) => ({
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    pricing: entry.pricing,
    create: () => entry.create(entry.id),
  }));
}

export function modelInfos(models: PlaygroundModel[]): ModelInfo[] {
  return models.map((m) => ({ id: m.id, label: m.label, provider: m.provider }));
}

/** The model to preselect: prefer Anthropic Sonnet, else the first available. */
export function defaultModelId(models: PlaygroundModel[]): string | null {
  const preferred = models.find((m) => m.id === 'claude-sonnet-5');
  return preferred?.id ?? models[0]?.id ?? null;
}
