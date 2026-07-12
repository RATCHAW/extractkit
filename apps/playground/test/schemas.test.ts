import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEMA_ID, getPreset, schemaInfos } from '../src/server/schemas';

describe('schemaInfos', () => {
  it('lists the invoice and receipt presets with their top-level fields', () => {
    const infos = schemaInfos();
    expect(infos.map((s) => s.id)).toEqual(['invoice', 'receipt']);
    const invoice = infos.find((s) => s.id === 'invoice');
    expect(invoice?.topLevelFields).toEqual([
      'vendorName',
      'invoiceNumber',
      'issueDate',
      'dueDate',
      'currency',
      'subtotal',
      'tax',
      'total',
      'lineItems',
    ]);
  });
});

describe('getPreset', () => {
  it('returns a parseable Zod schema for a known id', () => {
    const preset = getPreset('receipt');
    expect(preset).toBeDefined();
    const parsed = preset?.schema.safeParse({
      merchant: 'Cafe',
      date: null,
      lineItems: [{ description: 'Coffee', quantity: '1', unitPrice: '3.00', amount: '3.00' }],
      subtotal: '3.00',
      tax: '0.00',
      total: '3.00',
    });
    expect(parsed?.success).toBe(true);
  });

  it('is undefined for an unknown id', () => {
    expect(getPreset('contract')).toBeUndefined();
  });

  it('names a valid default schema', () => {
    expect(getPreset(DEFAULT_SCHEMA_ID)).toBeDefined();
  });
});
