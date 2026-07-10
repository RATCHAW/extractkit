import type { CompareKind } from './types.js';

/** NFKC, case-fold, collapse whitespace. */
export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Reduce a printed amount to sign + digits: "Rp 24,000" → "24000",
 * "-60.000" → "-60000", "@11000" → "11000". Locale-safe on the benchmark
 * documents because their amounts never carry meaningful decimal fractions
 * with the same separator as the thousands separator.
 */
export function normalizeMoney(value: string): string {
  const digits = value.replace(/[^0-9-]/g, '');
  const negative = digits.startsWith('-') || /\(\s*[0-9.,]+\s*\)/.test(value);
  const bare = digits.replace(/-/g, '');
  if (bare === '') return '';
  const trimmed = bare.replace(/^0+(?=\d)/, '');
  return negative ? `-${trimmed}` : trimmed;
}

/** Lenient count parse: "2.00" → "2", "1X" → "1", "1.5" → "1.5". */
export function normalizeCount(value: string): string {
  const match = value.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return normalizeText(value);
  const num = Number.parseFloat(match[0]);
  return Number.isFinite(num) ? String(num) : normalizeText(value);
}

export function normalizeValue(value: string, compare: CompareKind): string {
  switch (compare) {
    case 'text':
      return normalizeText(value);
    case 'money':
      return normalizeMoney(value);
    case 'count':
      return normalizeCount(value);
  }
}

/** Null matches only null; otherwise compare under the field's normalizer. */
export function valuesMatch(expected: string | null, predicted: string | null, compare: CompareKind): boolean {
  if (expected === null || predicted === null) return expected === predicted;
  return normalizeValue(expected, compare) === normalizeValue(predicted, compare);
}
