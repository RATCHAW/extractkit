import { describe, expect, it } from 'vitest';
import { benchmarkModels, PROVIDERS, selectProviders } from '../src/models.js';

const ANTHROPIC = { ANTHROPIC_API_KEY: 'test' };
const OPENAI = { OPENAI_API_KEY: 'test' };
const GOOGLE = { GOOGLE_GENERATIVE_AI_API_KEY: 'test' };

describe('selectProviders', () => {
  it('runs every provider whose API key is present when EVAL_PROVIDERS is unset', () => {
    expect(selectProviders({ ...ANTHROPIC })).toEqual(['anthropic']);
    expect(selectProviders({ ...ANTHROPIC, ...OPENAI, ...GOOGLE })).toEqual(['anthropic', 'openai', 'google']);
  });

  it('honors an explicit EVAL_PROVIDERS selection', () => {
    expect(selectProviders({ EVAL_PROVIDERS: 'openai', ...OPENAI })).toEqual(['openai']);
    expect(selectProviders({ EVAL_PROVIDERS: 'google, openai', ...OPENAI, ...GOOGLE })).toEqual(['google', 'openai']);
  });

  it('deduplicates repeated providers in EVAL_PROVIDERS', () => {
    expect(selectProviders({ EVAL_PROVIDERS: 'openai,openai', ...OPENAI })).toEqual(['openai']);
  });

  it('throws when a selected provider is missing its API key', () => {
    expect(() => selectProviders({ EVAL_PROVIDERS: 'openai', ...ANTHROPIC })).toThrow(/OPENAI_API_KEY/);
  });

  it('throws on an unknown provider name', () => {
    expect(() => selectProviders({ EVAL_PROVIDERS: 'grok', ...OPENAI })).toThrow(/Unknown provider "grok"/);
  });

  it('throws when no provider key is set at all', () => {
    expect(() => selectProviders({})).toThrow(/No provider API key found/);
  });

  it('treats a blank key value as absent, like the playground', () => {
    expect(selectProviders({ ANTHROPIC_API_KEY: '', ...OPENAI })).toEqual(['openai']);
    expect(() => selectProviders({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' })).toThrow(
      /No provider API key found/,
    );
  });

  it('rejects an explicitly selected provider whose key is blank', () => {
    expect(() => selectProviders({ EVAL_PROVIDERS: 'anthropic', ANTHROPIC_API_KEY: '' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('falls back to key auto-detection when EVAL_PROVIDERS is blank', () => {
    expect(selectProviders({ EVAL_PROVIDERS: '  ', ...GOOGLE })).toEqual(['google']);
  });
});

describe('benchmarkModels', () => {
  it('defaults to the three Anthropic models when only ANTHROPIC_API_KEY is set', () => {
    const models = benchmarkModels({ ...ANTHROPIC });
    expect(models.map((m) => m.name)).toEqual(['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('builds a model with pricing for every catalog entry across selected providers', () => {
    const models = benchmarkModels({ ...ANTHROPIC, ...OPENAI, ...GOOGLE });
    expect(models).toHaveLength(9);
    for (const m of models) {
      expect(m.model).toBeDefined();
      expect(m.pricing?.inputPerMTokUSD).toBeGreaterThan(0);
      expect(m.pricing?.outputPerMTokUSD).toBeGreaterThan(0);
    }
  });

  it('runs only the selected provider when EVAL_PROVIDERS narrows it', () => {
    const models = benchmarkModels({ EVAL_PROVIDERS: 'google', ...ANTHROPIC, ...GOOGLE });
    expect(models.map((m) => m.name)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });

  it('exposes all three providers', () => {
    expect(PROVIDERS).toEqual(['anthropic', 'openai', 'google']);
  });
});
