import { describe, expect, it } from 'vitest';
import {
  flattenFields,
  formatPath,
  formatValue,
  isField,
  leafLabel,
  pathKey,
  valueAtPath,
} from '../src/client/lib/fields';

const leaf = (value: unknown) => ({ value, confidence: 0.9, page: 0, bbox: null });

describe('isField', () => {
  it('recognizes a provenance leaf', () => {
    expect(isField(leaf('x'))).toBe(true);
    expect(isField(leaf(null))).toBe(true);
  });

  it('rejects branches and primitives', () => {
    expect(isField({ total: leaf('x') })).toBe(false);
    expect(isField(null)).toBe(false);
    expect(isField('x')).toBe(false);
    expect(isField({ value: 1, confidence: 'high', page: 0, bbox: null })).toBe(false);
  });
});

describe('flattenFields', () => {
  it('walks objects and arrays into leaf paths', () => {
    const fields = {
      total: leaf('10'),
      lineItems: [{ description: leaf('a') }, { description: leaf('b') }],
    };
    const flat = flattenFields(fields);
    expect(flat.map((f) => f.path)).toEqual([
      ['total'],
      ['lineItems', 0, 'description'],
      ['lineItems', 1, 'description'],
    ]);
    expect(flat[0]?.field.value).toBe('10');
  });

  it('skips null branches', () => {
    expect(flattenFields({ a: null, b: leaf('x') })).toHaveLength(1);
  });
});

describe('valueAtPath', () => {
  const data = { total: '10', lineItems: [{ description: 'a' }] };
  it('reads nested values', () => {
    expect(valueAtPath(data, ['total'])).toBe('10');
    expect(valueAtPath(data, ['lineItems', 0, 'description'])).toBe('a');
  });
  it('returns undefined off the end of the tree', () => {
    expect(valueAtPath(data, ['lineItems', 5, 'description'])).toBeUndefined();
    expect(valueAtPath(null, ['total'])).toBeUndefined();
  });
});

describe('path and value formatting', () => {
  it('formats paths with dotted keys and bracketed indices', () => {
    expect(formatPath(['lineItems', 0, 'amount'])).toBe('lineItems[0].amount');
    expect(formatPath(['total'])).toBe('total');
    expect(formatPath([])).toBe('(root)');
  });
  it('labels a leaf by its last segment', () => {
    expect(leafLabel(['lineItems', 2, 'amount'])).toBe('amount');
    expect(leafLabel(['lineItems', 2])).toBe('[2]');
  });
  it('renders values, with a dash for null', () => {
    expect(formatValue('USD')).toBe('USD');
    expect(formatValue(null)).toBe('—');
    expect(formatValue('')).toBe('(empty)');
    expect(formatValue(false)).toBe('false');
  });
  it('keys a path stably', () => {
    expect(pathKey(['lineItems', 0])).toBe('["lineItems",0]');
  });
});
