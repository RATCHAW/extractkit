import type { LanguageModelUsage } from 'ai';
import type { ExtractUsage, Pricing } from './types.js';

export interface MutableUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelCalls: number;
}

export function createUsage(): MutableUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 };
}

export function addUsage(usage: MutableUsage, sdkUsage: LanguageModelUsage | undefined): void {
  if (sdkUsage == null) return;
  const input = sdkUsage.inputTokens ?? 0;
  const output = sdkUsage.outputTokens ?? 0;
  usage.inputTokens += input;
  usage.outputTokens += output;
  usage.totalTokens += sdkUsage.totalTokens ?? input + output;
}

export function finalizeUsage(usage: MutableUsage, pricing: Pricing | undefined): ExtractUsage {
  return {
    ...usage,
    costUSD:
      pricing == null
        ? null
        : (usage.inputTokens * pricing.inputPerMTokUSD + usage.outputTokens * pricing.outputPerMTokUSD) / 1_000_000,
  };
}
