import { describe, expect, it } from 'vitest';
import { normalizeCount, normalizeMoney, normalizeText, valuesMatch } from '../src/normalize.js';

describe('normalizeText', () => {
  it('case-folds and collapses whitespace', () => {
    expect(normalizeText('  ICE  BLACKCOFFE ')).toBe('ice blackcoffe');
  });

  it('applies NFKC normalization', () => {
    expect(normalizeText('ＴＯＴＡＬ')).toBe('total');
  });
});

describe('normalizeMoney', () => {
  it('treats dots and commas as separators (Indonesian receipts)', () => {
    expect(normalizeMoney('60.000')).toBe('60000');
    expect(normalizeMoney('24,000')).toBe('24000');
    expect(normalizeMoney('24000')).toBe('24000');
  });

  it('keeps the sign of negative amounts', () => {
    expect(normalizeMoney('-60.000')).toBe('-60000');
  });

  it('strips currency symbols and prefixes', () => {
    expect(normalizeMoney('@11000')).toBe('11000');
    expect(normalizeMoney('Rp 91.000')).toBe('91000');
    expect(normalizeMoney('$1,234')).toBe('1234');
  });

  it('drops leading zeros', () => {
    expect(normalizeMoney('007')).toBe('7');
  });
});

describe('normalizeCount', () => {
  it('parses quantity formats seen in CORD', () => {
    expect(normalizeCount('2')).toBe('2');
    expect(normalizeCount('2.00')).toBe('2');
    expect(normalizeCount('1X')).toBe('1');
    expect(normalizeCount('1x')).toBe('1');
  });

  it('keeps fractional quantities', () => {
    expect(normalizeCount('1.5')).toBe('1.5');
  });
});

describe('valuesMatch', () => {
  it('null only matches null', () => {
    expect(valuesMatch(null, null, 'money')).toBe(true);
    expect(valuesMatch(null, '5', 'money')).toBe(false);
    expect(valuesMatch('5', null, 'money')).toBe(false);
  });

  it('compares under the field normalizer', () => {
    expect(valuesMatch('24.000', '24,000', 'money')).toBe(true);
    expect(valuesMatch('2.00', '2', 'count')).toBe(true);
    expect(valuesMatch('JASMINE  MT ( L )', 'jasmine mt ( l )', 'text')).toBe(true);
    expect(valuesMatch('24.000', '2400', 'money')).toBe(false);
  });
});
