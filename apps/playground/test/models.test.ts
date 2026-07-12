import { describe, expect, it } from 'vitest';
import { defaultModelId, modelInfos, resolveModels } from '../src/server/models';

describe('resolveModels', () => {
  it('offers only models whose provider key is set', () => {
    const models = resolveModels({ OPENAI_API_KEY: 'sk-test' });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'openai')).toBe(true);
  });

  it('treats an empty-string key as unset', () => {
    expect(resolveModels({ ANTHROPIC_API_KEY: '' })).toEqual([]);
  });

  it('combines providers when several keys are present', () => {
    const providers = new Set(
      resolveModels({ ANTHROPIC_API_KEY: 'a', GOOGLE_GENERATIVE_AI_API_KEY: 'g' }).map((m) => m.provider),
    );
    expect(providers).toEqual(new Set(['anthropic', 'google']));
  });

  it('returns nothing when no key is present', () => {
    expect(resolveModels({})).toEqual([]);
  });
});

describe('defaultModelId', () => {
  it('prefers Claude Sonnet when available', () => {
    expect(defaultModelId(resolveModels({ ANTHROPIC_API_KEY: 'a' }))).toBe('claude-sonnet-5');
  });
  it('falls back to the first available model', () => {
    expect(defaultModelId(resolveModels({ OPENAI_API_KEY: 'o' }))).toBe('gpt-5.6-luna');
  });
  it('is null when there are no models', () => {
    expect(defaultModelId([])).toBeNull();
  });
});

describe('modelInfos', () => {
  it('exposes only id, label, and provider', () => {
    const infos = modelInfos(resolveModels({ ANTHROPIC_API_KEY: 'a' }));
    expect(infos[0]).toEqual({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' });
    expect(Object.keys(infos[0] ?? {})).toEqual(['id', 'label', 'provider']);
  });
});
