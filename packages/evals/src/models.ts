import { anthropic } from '@ai-sdk/anthropic';
import type { EvalModel } from './types.js';

/**
 * The benchmark lineup. Pricing is the standard per-MTok list price from
 * platform.claude.com/docs/en/pricing as of 2026-07 (claude-sonnet-5 has a
 * lower introductory price through 2026-08-31; the durable list price is
 * used so published cost numbers don't expire with the promotion).
 */
export function benchmarkModels(): EvalModel[] {
  if (process.env['ANTHROPIC_API_KEY'] === undefined) {
    throw new Error('ANTHROPIC_API_KEY is not set; the benchmark cannot run without model access.');
  }
  return [
    {
      name: 'claude-opus-4-8',
      model: anthropic('claude-opus-4-8'),
      pricing: { inputPerMTokUSD: 5, outputPerMTokUSD: 25 },
    },
    {
      name: 'claude-sonnet-5',
      model: anthropic('claude-sonnet-5'),
      pricing: { inputPerMTokUSD: 3, outputPerMTokUSD: 15 },
    },
    {
      name: 'claude-haiku-4-5',
      model: anthropic('claude-haiku-4-5'),
      pricing: { inputPerMTokUSD: 1, outputPerMTokUSD: 5 },
    },
  ];
}
